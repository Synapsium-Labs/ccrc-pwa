# Native Docs reader, the shared library's 1.1 take-up (one bar, Mermaid drawn after ready) — Implementation Plan

> **For agentic workers:** this wave is dispatched by the programme's coordinator as one run (see "How this wave runs" below). The worker executes it with REQUIRED SUB-SKILL superpowers:subagent-driven-development (recommended) or superpowers:executing-plans, task by task, under the `ccrc-worker` skill. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** rev 3 (2026-11-07), Q1-Q3 approved with every recommendation through console item 48; library 1.1.0 publication verified. Task 9 now makes Reader lab and Measure highlighting discoverable in Settings; Task 10 closes. Unsupported auto-to-after-ready measurement equivalence is removed. The plan is not yet merged: exact-tip checks and review of the amendment remain before landing and dispatch. Originally drafted on 2026-11-05 before the library's v1.1.0 tag existed. Base: `origin/main` at `ce55b1ca967fa2f2af6ac71d8755f83447c57a82` (the merge of #2340, the reader lab's page). Every Find block below is quoted from that commit. The programme's open ledger PR (#2345) changes other lines of the rich-docs spec and the reader lab design than the ones quoted here (measured: the lines it changes are §4.7's reader-lab bullet, E18, A24, M10.4, M10.10, M10.13 and RD36 in the spec, and the design's own revisions), so its merge leaves every Find block matching. #2345 has since merged (`d32c339d3`); Task 8 Step 3's `**Revisions:**` Find is the one block quoted from that merge, because #2345 rewrote that line. **Task 1 Step 0 re-checks every Find block against the dispatch base** with one script, and a miss is a stop-and-ask. This plan replaces nothing.

**Scope:**
- In: the exact pin moves from 1.0.0 to 1.1.0, with every W8a guard carried; the Docs reader draws Mermaid on open, after `ready`, when the reader lab's E17 `mermaid` line held on the operator's phone, and on request as today when it did not (one recorded reading, `policy.ts#READER_E17_MERMAID`); the reader lab's `lab-draw` profile stays the E17 instrument, unchanged in behaviour; on a phone, a leaf whose reader frame is ready gets one bar (the phone header's option 2): the frame's own bar off, its top space trimmed, its quick jump and contents (and a plan's Outline) on ccrc's buttons, its reading progress drawn by ccrc, the document's title on the bar, and the details panel behind the title; the adapter census and every other census these touch; the spec and design text the take-up changes (the rich-docs spec, the base spec's §4.4, §4.5, §4.7 and §4.17, and the reader lab design's §8 and RL14); Task 9 adds the two existing diagnostic routes to the Settings index, without changing the five ordinary sections.
- Out: W8a's residue, which stays with W8b (the programme ledger's "Carried constraints"); the RL-a, RL-b and header residue (no file they name is edited, see Global Constraints); any change to the shared library, its bridge or its frame; a report op for overlay state or a running head (the library's Later); a lab profile that draws after `ready`; the Docs listing pages and Docs pages at 600 CSS px and wider, except that a one bar mounted on a phone stays when the window widens (refinement (f)); Task 9's two Settings diagnostic rows apply at every width and are the explicit non-Docs access correction; the server, the agent, `ccd` and `shared/`; the README; the programme ledger (the coordinator's).
- Byte-identical: `pwa/src/readerLab/**` but one comment in `run.ts` (refinement (d)), `pwa/src/docs/reader/assets.ts`, `labPolicy.ts`, `images.ts`, `readerText.ts`, `pwa/src/docs/DocsLeaf.tsx`, `DocsBanners.tsx`, `ShareSheet.tsx`, `ExportSheet.tsx`, `export/**`, `pwa/index.html`, `pwa/vite.config.ts`, `pwa/vitest.browser.config.ts`, `pwa/browser/app.ts`, `harness.ts`, `pwa/test/reader-lab-run.test.ts`, `pwa/test/reader-lab-verdicts.test.ts`, `pwa/test/docs-scans.test.ts`, `pwa/test/reader-assets.test.ts`, `pwa/test/reader-built.test.ts`, `.github/**`, `server/**`, `shared/**`, `ui/**`, the phone header plan, the reader lab plan and the ledger. Any other file is a stop-and-ask.

**Goal:** On the operator's phone (CSS viewport about 412 x 915) a reader doc's title sits at 125 px today: the console's one row (44 px and a 4 px gap) and the frame's own bar and gap (77 px). After this wave the console draws the only bar, the frame's top space is trimmed, and the title sits at most 61 px down (the option 2 mockup's trimmed figure; prediction 56). The reader's quick jump and contents are one tap on that bar, the progress line runs along its bottom edge, and nothing the page says about what it served is lost: it is one tap away, behind the title. And where E17 held, a spec's figures draw by themselves after the page is up, without holding `ready`.

**Architecture:** One L1 file decides and three L4 files act. `pwa/src/docs/reader/policy.ts` gains the E17 reading (`READER_E17_MERMAID`, `docsDrawFor`), whose bar a mount has (`ReaderChrome`, `readerChromeFor`), the tools and the title of the one bar (`oneBarTools`, `readerBarTitle`), and `readerMountPlan` grows to carry the bar and take the reading. The L3 adapter `docs/reader/bridge.ts` applies the plan: drawn after `ready` it hands the library the Mermaid loader (`loadMermaid`) and awaits nothing; drawn on request or on open (the lab) it keeps today's pre-mount load and scan drop, and the lab's D-8030 report; on ccrc's bar it passes `features` and `onProgress`; and its mount gains `command`. `DocsScreen` holds a new slot (`docs/readerBar.ts`, the `ExportBodyContext` pattern) that tells `ReaderFrame` which bar to mount with and hears back, once that frame is ready, the bar's handle: the title, the commands and a progress store. `docsHeadWords#headLayoutFor` gains a third answer, `one-bar`, for a leaf whose frame takes commands, and `OneBar` reuses the compact row's box, its first line, `BackButton`, `Crumbs`, `TruthLine`, `Actions`, `freshDot` and the disclosure of option 1.

**Tech Stack:** TypeScript (pwa's own `tsc`, strict), React 19 (`useSyncExternalStore`, `useId`), vitest on jsdom with `typecheck` on (`*.test-d.ts`), the browser leg (`vitest.browser.config.ts`, `playwright-core` driving Chromium over the run's one production build), `@synapsium-labs/docserver` 1.1.0 (`./host`'s `mountDocFrame` with `mermaidDraw: 'after-ready'`, `loadMermaid`, `features.chrome`, `onProgress`, `DocFrame.command`), `@ccrc/ui`'s `Icon` over already-vendored lucide nodes (`search`, `layout-list`, `list-checks`).

**Spec:** `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` (the rich-docs spec): §4.4 (the bridge), §4.6 (`reader-mermaid-on-tap`, the budget), §4.7, §5.2, §5.3 E17, §7.1 M8.6, §7.2 M8.B7, §8 (the waves table and Figure 3), RD14. `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` (the base spec): §4.4, §4.5, §4.7, §4.17, which the operator ruled are "amended in one place when option 2 lands" (the phone header plan, "Answered by the operator", Q1). `docs/superpowers/specs/2026-11-03-reader-lab-design.md` §8 and RL14. The library's own text at 1.1.0 (`50cef012a`): its CHANGELOG's 1.1.0 entry, its README's `./host` and bridge sections, and its batch plan's "Later" bullet "The first consumer's take-up wave", which is this wave's core list.

**Ruling:** the operator's rulings of 2026-11-03 (draw Mermaid on open, following E17, behind a library change) and of 2026-11-03/04 (the phone header: option 1 now, option 2 with the library release), and the library batch's answers of 2026-11-04 (Q5: E17 measured in this wave; Q8: `chrome.topSpace`; Q9: no title op, the host reads `result.meta.title`). Questions Q1 to Q3 below are this wave's own.

**Ledger:** `docs/superpowers/programs/native-docs-reader.md` (Waves row 17; "Next-wave brief (library 1.1 take-up)"). The coordinator's ledger PR records this plan, the E17 block and the operator's answers.

**Branch rule:** commit on the workspace branch, never a separate feature branch (a feature branch wedges every close with `stale-tip`).

**Format:** Markdown. `server/test/deviation-refs.test.ts` and the ledger's floor scan read `*.md` plans; Task 1's find-check reads this file's `Find (...)` blocks, and Task 10's tools parse its `### Task` headings and the JSON row fences each task records.

**What the base says (each checked at `ce55b1ca9`, each handled below):**
- **The pin.** `pwa/package.json:20` is `"@synapsium-labs/docserver": "1.0.0"`; the lock's root line `pwa/package-lock.json:14` and its entry `:3255` carry 1.0.0, `https://registry.npmjs.org/@synapsium-labs/docserver/-/docserver-1.0.0.tgz` and a sha512 integrity. `pwa/test/reader-pin.test.ts:12-37` pins 1.0.0 in four of its five cases (five `toBe` assertions and the `resolved` URL). The library's dependencies at 1.1.0 are exactly 1.0.0's (`highlight.js` 11.12.0 among them, measured from its `package.json` at `50cef012a`), so the lock's diff is the library's four lines alone (the root's dependency line and the entry's `version`, `resolved` and `integrity`).
- **M8.16 reads the lock, not a version.** `.github/ci/library-provenance.sh:35-58` packs the version the lock names, checks the lock's integrity, then `gh attestation verify --source-ref refs/tags/v$version`; `ci.yml:1300` runs it before any install and `:1317` runs `npm audit signatures`. Nothing in it names 1.0.0, so the bump carries it unchanged.
- **ccrc pins no frame hash and no srcdoc cap by hand.** The shell's one policy is `frame-src 'none'` (`pwa/index.html:6`, pinned exactly by `pwa/test/reader-built.test.ts:129-144`), with no `script-src`, so the library's warning ("a host that pins its page policy by hand and does not re-pin it gets no `ready`") does not apply. The frame's own policy is `frameCsp()` from the installed library (`reader-bridge.test.ts:348-360` pins the iframe's `csp` equal to it), and every hash test reads `FRAME_MANIFEST` (`pwa/test/reader-assets.test.ts:31-111`, `reader-built.test.ts:88-127`). `MAX_SRCDOC_CHARS_DEFAULT` appears nowhere in `pwa/`, `server/`, `shared/` or `.github/` (zero hits). What moves at 1.1.0: `frame/bootstrap.js`, `frame/enhance.js`, `frame/reader.css` and `reader.css` (the last unused by ccrc), so `frameCsp()`'s output, and `READER_LIBRARY_BUILD` (`pwa/src/docs/reader/labPolicy.ts:12`, the first 12 hex of enhance's sha256), from `0079625cc30a` to `6bcf14892e48`: a lab block from 1.1.0 names the new build. `frame/guard.js` and both Mermaid builds do not move.
- **The adapter today.** `pwa/src/docs/reader/bridge.ts:4-7` says the adapter set is exactly fourteen keys and never `features`; `:109-129` loads the Mermaid text before the mount, inside the watchdog, and drops the scan when it fails, reporting the drop (D-8030) only for `plan.draw === 'auto'` (`:125`); `:132-147` builds the adapters with `mermaidDraw: plan.draw`. `pwa/src/docs/reader/policy.ts:150-157`: the Docs reader draws `on-request`, the lab's `lab-draw` `auto`. `pwa/test/reader-bridge.test.ts:84-93` pins the fourteen keys; `:142-235` the pre-mount load; `:396-434` the lab profile. `pwa/test/reader-lab-bridge.test.ts:26-52` pins the D-8030 seam.
- **The lab's window.** `pwa/src/readerLab/run.ts:49-60`: `LAB_GAP_WINDOW = 'ready'`, whose comment says "The library change that draws after `ready` flips it, in that change". The library's change shipped as a third mode and left `auto` as it was (its CHANGELOG, 1.1.0 item B; `src/host/mount.ts` at `50cef012a`: `late` is true only for `'after-ready'`).
- **`ReaderMount` fakes.** `pwa/test/reader-lab-run.test.ts:131` builds a reader mount `satisfies ReaderMount`, so a new required member on `ReaderMount` would red that file's typecheck (refinement (i) makes `command` optional for that reason).
- **The library's command names are not exported by `./frame`.** `src/frame/index.ts` at `50cef012a` exports no `COMMAND_OPS`; the names reach ccrc only as `DocFrame['command']`'s parameter type. And `pwa/test/docs-scans.test.ts:217-222` admits `./frame` only under `src/docs/reader/` and `./host` only in `bridge.ts`, so `DocsHead.tsx` may import neither; ccrc's own `ReaderCommand` type is held equal by a type test.
- **Where the reader is mounted.** `pwa/src/docs/ReaderFrame.tsx:59-65` (`lazyMountReader`), `:273-298` (the mount input), `:371-379` (the arm that renders the host and publishes `READER_BODY` through `ReaderShown`, `:122-125`). `pwa/src/screens/DocsScreen.tsx:187-189` holds Export's body and highlight-store slots, `:333-336` renders `DocsHead`, `:342-344` provides `ExportBodyContext`. The lab mounts through `lazyMountReader` directly (`pwa/src/readerLab/run.ts:14,176`), never through `ReaderFrame`, so a context `ReaderFrame` reads is invisible to it.
- **The head.** `pwa/src/docs/DocsHead.tsx` owns `DOCS_COMPACT_QUERY`, the compact branch, `CompactLabel`, `CompactRow`, `HeadRow`, `useRowStage`, `nameCut` and `rowFits`. C16 moves only the pure layout/stage policy to `pwa/src/docs/docsHeadWords.ts`, including `HeadLayout` and `headLayoutFor`; preserve that sole owner. `pwa/test/docs-compact-head.test.tsx:84-96` is `headLayoutFor`'s table. `pwa/src/docs/docs.css:352-394` is the compact head's block. The phone header plan's Later (`docs/superpowers/plans/2026-11-03-native-docs-reader-phone-header.md`, "Option 2, with the library release") names what option 2 reuses: `headLayoutFor` gains a third answer; `useHeadActions` stays the one reader of the actions; the panel's body is one block, which option 2's details sheet, opened by tapping the title, holds; `freshDot` and its names move beside the title; the row leaves room for the library's tools.
- **The browser rows that assume today's draw and today's head.** `pwa/browser/reader-frame.browser.test.ts:621-680` (M8.B1 taps Render on every figure), `:1018-1041` (M8.3 live: Mermaid's text in the srcdoc once), `:1117-1154` (M8.8 taps Render), `:1222-1256` (the worst case: Mermaid inlined once). `pwa/browser/docs-compact-head.browser.test.ts:197-384` expects option 1's row on a ready reader leaf at 412, 599 and in Instrument, and pins `PHONE_TITLE_MAX` 133 on it. Both files open leaves at 1280 by default (`reader-frame.browser.test.ts:398-403`).
- **The censuses this wave meets.** `pwa/test/control-census.test.ts:435-448` (a control by file, tag and class, TOKEN claims checked against the stylesheets); `pwa/test/tap-targets.test.tsx:342-358` (the floor half's loop) and `:1190-1219` (the compact head's two halves); `pwa/design/audit.mjs:1160-1169` (`INHERITED_GROUNDS` for the compact head; `contrast.test.ts` measures every `docs.css` rule that sets `color`); `pwa/test/docs-compact-css.test.ts` (the head's declarations); `pwa/test/markup-census.test.ts` (two blocks of one shape, two equal class literals, two equal leaves); the server's `rings/pwa-rings.test.ts` (an L1 file loads no `.tsx`) and `rings/ringContextMap.ts` (C9's `docs/**` row already covers a new `pwa/src/docs` file).

## Phone evidence received (2026-11-06)

The operator supplied two blocks in chat for console item 53 (which replaces withdrawn item 47). Both measure library build `0079625cc30a`, the 1.0.0 instrument, not 1.1.0's `6bcf14892e48`. Preserve both blocks: the second passes, but does not erase the first failure. Record `E17-READING does-not-hold` and `E17-BLOCKS 2` in Task 1 Step 2. The operator separately approved Q1-Q3 with every recommendation through console item 48 on 2026-11-06. Under that approved Q1 rule this selects **arm B with a block**: the Docs reader keeps drawing on request.

### Block 1 — Mermaid does not hold

```text
reader-lab 1 · Blink 156 · Android · 8 cores · worker yes · frame sandbox yes · csp attribute yes · library 0079625cc30a
E18 walls: 7 of 7 hold; teardown signal holds
  opaque-origin      holds
  no-ambient-state   holds
  no-cookie          holds (5 arrived, 0 with the cookie; the control carried it)
  csp-27             holds (0 of 27 reached; 26 measured; not measured: iframe; library 0 of 1 attempted)
  no-popup-top-nav   holds
  no-self-navigate   holds (attempt seen: second load)
  bridge-strays      holds (8 sent, 0 effects; observed navigate, hash, copy; store.set and a same-source-only listener not exercised)
  self-nav-teardown  holds (second load fired)
E17 responsive (mermaid budget 200 ms):
  busy-frame         shared thread (longest gap 2994 ms in a 3000 ms spin; watchdog timer 2520 ms late; shared-thread evidence: gap and timer)
  mermaid            does not hold (longest gap 217 ms, all six together; worst single: figure 4, 150 ms)
    gaps ms          none 17 ready · trivial 100 ready · f1 133 ready · f2 133 ready · f3 133 ready · f4 150 ready · f5 142 ready · f6 125 ready · all 217 ready
draw on open: needs one figure per task here; every single figure fits the budget
door: 48 counted, 0 ignored; session cookie sent
```

### Block 2 — Mermaid holds

```text
reader-lab 1 · Blink 156 · Android · 8 cores · worker yes · frame sandbox yes · csp attribute yes · library 0079625cc30a
E18 walls: 7 of 7 hold; teardown signal holds
  opaque-origin      holds
  no-ambient-state   holds
  no-cookie          holds (5 arrived, 0 with the cookie; the control carried it)
  csp-27             holds (0 of 27 reached; 26 measured; not measured: iframe; library 0 of 1 attempted)
  no-popup-top-nav   holds
  no-self-navigate   holds (attempt seen: second load)
  bridge-strays      holds (8 sent, 0 effects; observed navigate, hash, copy; store.set and a same-source-only listener not exercised)
  self-nav-teardown  holds (second load fired)
E17 responsive (mermaid budget 200 ms):
  busy-frame         shared thread (longest gap 2992 ms in a 3000 ms spin; watchdog timer 2516 ms late; shared-thread evidence: gap and timer)
  mermaid            holds (ready; longest gap 192 ms, all six together; worst single: figure 5, 150 ms)
    gaps ms          none 17 ready · trivial 108 ready · f1 133 ready · f2 125 ready · f3 133 ready · f4 133 ready · f5 150 ready · f6 125 ready · all 192 ready
draw on open: fits the budget here, though the frame shares the thread
door: 48 counted, 0 ignored; session cookie sent
```

- **E18:** both blocks report all seven walls and teardown holding. Preserve their coverage limits: the CSP iframe channel is not measured; the library half reports 0 of 1 attempted; `store.set` and a same-source-only listener were not exercised. This is the lab's bounded result, not proof of every possible sandbox escape being absent.
- **E17:** block 1's 217 ms exceeds the accepted 200 ms Mermaid budget; block 2's 192 ms passes it. Every single-figure mount fits in both blocks (worst 150 ms). The approved Q1 requires every supplied block to hold, so the combined reading remains `does-not-hold`, with two blocks. Do not average the measurements or replace the failed block with the passing one. Both busy-frame lines demonstrate a shared thread and are diagnostic, not separate gates.
- **Scheduling:** block 1's “one figure per task” is the instrument's recommendation, not evidence that the reader implements that scheduling. Block 2 does not establish a scheduling change or a consistently passing all-six mount. Neither block measures the 1.1.0 build or the after-ready mode. This receipt does not add a scheduling change to this wave or waive the budget.
- **Access correction:** Search → `reader lab` → “Go to Settings › Reader lab”, or `/settings/reader-lab`. The Settings index has no row today. Visible Settings rows for Reader lab and Measure highlighting are this take-up wave's Task 9. This is the owed access correction, not a claim that those rows already shipped.

## Operator answers and release receipt (2026-11-06)

- **Plan approval:** console item 48 records “Approve with every recommendation (Q1-Q3 as recommended)”. Q1: after-ready only when every supplied E17 Mermaid block holds; otherwise on request. Q2: the frame's own Aa only. Q3: Share, Export and View on GitHub in the title's details panel, with no extra menu. The questions and alternatives below are retained as the decision record.
- **Release:** signed tag `v1.1.0` at `50cef012aa671974473d19c2acd77f900e9d03af`; release run `42245203228`, attempt 2, completed successfully, including tag verification, both test jobs, build, attestation, publish, GitHub release and post-verify. The first attempt's WebKit B8.2 reset-to-top failure was not bypassed; the unchanged-tag retry passed. Its root cause remains unproven.
- **Registry:** npm reports version `1.1.0` and `latest` `1.1.0`, with integrity `sha512-r2YCt15tGxOYKK1ONyZ/TzvpMdcC3bmUJvifmTdtrCPHxy8DG5nc65ImUi9RpPf+M82784HwMt52kdnkYcpqUg==`. The GitHub release is published, neither draft nor prerelease: https://github.com/Synapsium-Labs/docserver/releases/tag/v1.1.0 . Task 1 and Task 2 still re-check the package and its provenance at execution.
- **Not yet done:** the plan has not merged and no take-up implementation has been dispatched. The Settings-access amendment is written in Task 9; exact-tip checks and amendment review remain before the plan lands. Publication of the library does not upgrade the PWA by itself.

## Global Constraints

- **SAFETY.** Never run `ccd` against the live HOME; never run a destructive ccd verb; never touch tmux, `~/.cc-sessions`, `~/.cc-limits` or `claude-session@*` units; never call the live ccrc server; never print a secret file's contents and never put a token in an argv (read-only `gh` verbs only, `GH_TOKEN` from the environment). No test reaches a network or a real server: the browser files serve the run's own build from loopback and answer `/api` from fixtures. The two network reads this wave makes are the registry's and GitHub's, for the published package (Task 2), each read-only.
- **FIXTURE HOME.** No task runs `ccd`. If a guard suite drives `ccd`, it runs under `makeCcdHarness` fixture HOMEs only; quote every fixture path.
- **LOW DISK.** No new worktrees, no `git archive` copies, no second checkout or `node_modules`. The run installs `ui/`, `pwa/` and `server/` modules once (`npm ci` in each); Task 2's `npm install` replaces one package inside `pwa/node_modules`. The library's tarball for the provenance check goes to a temporary directory the script makes and the runner reaps (`library-provenance.sh:43`), about 1 MB. Mutation rows run **in the workspace**, sequentially: save the file to `$HOME/.cc-tmp/l11-mut/<id>.orig` with its sha256, apply the row (the `Edit` tool, exact unique match), run the row's tests, record the red line, restore from the saved copy (never `git checkout`), check the sha256 and that `git status --porcelain` is unchanged. Bounded: `timeout -k 10 600` (`timeout -k 10 900` for a browser row, which rebuilds) and `ulimit -u 4096`. `$HOME/.cc-tmp/l11-mut/` is removed at Task 10.
- **Rings and seams.** `policy.ts` stays L1: pure, no timer, no DOM, no runtime import of a `.tsx`, a store, `lib/api.ts` or the library (its new imports are types). `bridge.ts` stays the one file that imports `./host`; it decides nothing a policy decides. `readerBar.ts` is L4 (a hook and a small store). `ReaderFrame.tsx`, `DocsScreen.tsx` and `DocsHead.tsx` stay L4: they read the policy's answers and render. No overloaded null at a seam: `ReaderMount.command` absent means "this mount has no frame to command" (the inert mount of a failed asset load, or a test fake); `DocsHead`'s `readerBar` absent or `null` means "no frame on this page takes commands"; `ReaderMountInput.chrome` absent means the frame's own bar.
- **Exact values.** `READER_E17_MERMAID` is the reading Task 1 Step 2 records; `ReaderChrome` is `'frame-bar' | 'host-bar'`; the host bar's features are exactly `{ chrome: { bar: false, topSpace: false } }`; the one bar's tools are `jump` and `contents`, plus `outline` on a `plans` leaf, and never `settings` (Q2); icons `search` (Quick jump), `layout-list` (Contents), `list-checks` (Outline), size 20; the words `DOCS_TOOL_TEXT` = Quick jump, Reading settings, Contents, Outline; the reading line 2 px tall at the bar's bottom edge, inside its 44 px, `background: var(--accent)`, no opacity and no transition; the browser file's `ONE_BAR_TITLE_MAX` 61, `CONSOLE_PART_MAX` 48, `TAP` 44, `PHONE` 412 x 915.
- **Never spelled by this wave:** the library's package or directory name in `pwa/src` outside the files docs-parity M7.9 and docs-scans already admit (no new import site of the library: `DocsHead.tsx`, `ReaderFrame.tsx`, `DocsScreen.tsx` and `readerBar.ts` import none of it); a literal colour in `docs.css`; `44px` in a size declaration; `599.98` outside `docs/DocsHead.tsx`; `'lab-draw'` outside `policy.ts` and `readerLab/run.ts` (`reader-lab-scans.test.ts` rule 4); a numeric line citation (`file.ts` + colon + line) in any code or test file (cite `file#symbol`); a `D-` number outside `## Deviations found`, except the numbers already defined that the spec text and code comments cite (D-7953 to D-7955, D-8030); a placeholder deviation token in any commit; real host, user, project, account or path names (fixtures use `demo`, `specs`, `plans`).
- **PUBLIC REPO.** Code, docs, commit messages, branch names, the PR body and every comment are public. Task 10 scans every changed file and the PR body before the push; every mail is gated on the same scan (rc 0, zero hits). The E17 block names no host, origin, nonce or user agent and may be quoted as it is.
- **Locate every edit by content.** Original Find blocks are quoted from `ce55b1ca9`; the header-policy/comment blocks below are re-anchored to C16 at `43dfc2a51311f7e587636677998258491668429e`, pending its required merge and claim release. Validate every Find at the actual post-C16 dispatch base; each must match exactly once; apply a task's blocks in the order written. A block absent or matching twice is a stop-and-ask. The spec amendments carry the date the run commits them: where that is after 2026-11-05, every `(amended 2026-11-05; …)` in this plan's Replace blocks takes the commit's date.
- **Mutation-table discipline.** Every new guard ships with a row that goes red when the guard is deleted or mutated, measured. Each task ends with its rows as a table and one JSON fence (`id`, `spec`, `pkg`, `file`, `old`, `new`, `tests`, `red`), recorded in the SDD ledger as measured; Task 10 runs the whole table at the end state and keeps the last occurrence of each id. Ids are `L11-T<n>-M<k>`; `spec` carries the refinement letter. `pkg` is where the tests run and `file` is relative to it. Every count here (a row's red, a case count, a figure) is a prediction; a measured red that differs is reported to the coordinator with the extra names and restated (no number); a row that stays green is a stop-and-ask.
- **Test commands.** `( cd pwa && ./node_modules/.bin/vitest run test/<file> )`; the browser files `( cd pwa && CCRC_CHROME=<the brief's Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/<file> )`; never bare `npx vitest`. Every run in the foreground, Bash timeout 600000 ms; heavy runs (full package suites, typecheck, `contrast.test.ts`, `reader-built.test.ts`, every browser file, every mutation run) through `ccrc test`. Re-run a timeout or a lost worker alone before calling it broken. Typecheck: `( cd pwa && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json && echo TSC-OK )`. `git fetch -q origin main` before `deviation-refs`, `dtbd` and `topology-clean`.
- **CI.** A change to `pwa/package.json` and the lock makes the PR run the full server suite (the selection's rule), so the PR's CI is slower than usual. A pull request skips the browser leg (`browser (pwa)`); the merge queue runs it. The two reader/header browser files run in Task 7; the complete browser suite runs in Task 10 after the Settings addition.
- **Deviations.** The plan's body and tasks spell no new `D-` number; a departure is named by its refinement letter. One refinement departs from a design or spec sentence: (d). Numbers are ISSUED by `POST /api/ledger/deviations` at run-open, never looked up; the coordinator allocates and defines the known departure (d) in its ledger in the same act before dispatch, then includes that issued definition in the brief. Task 10 reconciles that definition and appends later departures from the already issued reserve; it does not postpone the known definition until close. An issued number left unused is written without its prefix. A session that cannot reach the allocator says so (worker clause 11) and writes no placeholder token.
- **Scratch.** PR-body and mutation scratch are under the session temp root, never inside the worktree, even where an older task template names `.superpowers/`; intended committed task evidence stays in its declared notes path.
- **Commits.** One per task (review fixes one per finding), files staged by name, message `<area>: <what> (docs library 1.1 take-up)`, ending with the `Co-Authored-By:` trailer the dispatch gives. Only Task 10 pushes, and it opens the ONE pull request.
- **Residue.** This wave edits none of the files the ledger's RL-a, RL-b and header residue name (`reader-lab-run.test.ts`, `readerLab/verdicts.ts`, the reader lab plan, the phone header plan, `openLeaf`, the door's files), so none of that residue is taken; W8a's residue stays with W8b. If a step finds it must edit one of those files, it stops and asks: the residue then comes with it.

## How this wave runs (coordinator)

- **The gates.** Run 1532 is open at `planned`. It is dispatched once (1) the operator has signed and pushed the library's v1.1.0 tag on `50cef012a` and approved its npm release (console item 42), and the coordinator has read the published package and the GitHub release; (2) the operator has answered Q1 to Q3; and (3) the operator's E17 block is in hand (console item 53; result received 2026-11-06 above), or the operator has answered Q1 that the wave lands without one (then the reading is `not-measured` and the Docs reader keeps drawing on tap).
- **The plan reaches `main` first**, through the programme's ledger PR, with the E17 block and the answers. **C16 ordering is mandatory:** #2497 must be independently proved merged and claim 3842 released before adoption dispatches or edits its shared header paths. Coordination mail is not leave; a scoped agreement does not replace this gate. Preserve merged #2480 and C16 behavior and obtain fresh post-C16 BASE figures, not their historical values.
- **The issued block.** At run-open the coordinator is issued a contiguous block by `POST /api/ledger/deviations`: one for refinement (d), defined in the ledger in that same act, and three in reserve for departures found while executing and in a fix round. The run is dispatched with no `sessionId`, so a fresh child workspace is minted from `main`.
- **Claims** are checked at dispatch and again at the start of each task that edits a shared file: `pwa/package.json`, `pwa/package-lock.json`, `pwa/src/docs/DocsHead.tsx`, `pwa/src/docs/docsHeadWords.ts`, `docsText.ts`, `docs.css`, `ReaderFrame.tsx`, `reader/bridge.ts`, `reader/policy.ts`, `pwa/src/screens/DocsScreen.tsx`, `pwa/src/readerLab/run.ts`, `pwa/design/audit.mjs`, `pwa/test/tap-targets.test.tsx`, `pwa/test/control-census.test.ts`, `pwa/test/docs-compact-css.test.ts`, `pwa/test/docs-compact-head.test.tsx`, `pwa/test/reader-bridge.test.ts`, `pwa/test/reader-lab-bridge.test.ts`, `pwa/test/reader-frame.test.tsx`, `pwa/test/reader-policy.test.ts`, `pwa/test/reader-pin.test.ts`, both browser files, the three specs; `pwa/src/screens/settings/SettingsIndex.tsx`, `pwa/test/settings-frame.test.tsx`, `pwa/test/settings-screen.test.tsx`, `pwa/test/command-layer.test.tsx` and `pwa/test/command-registry.test.ts`. Where another run holds a non-C16 path, the brief names the coordinator's scoped agreement; the C16 merge/release gate above is unconditional. A subagent edit outside the claim is the worker's to claim first.
- **Dispatch:** one `ccrc-worker` brief (`WORKER_KICKOFF_PREFIX`) carrying WAVE SPECIFICS only: this plan's path, Tasks 1-10, the base, the issued block, the claim state, `CCRC_CHROME`, the published package's version and integrity as the coordinator read them, the E17 block(s) verbatim (or the operator's Q1 answer that there is none), the operator's answers to Q2 and Q3, and the branch-discipline sentence. Routing: Opus/high main loop; `sonnet`/`high` implementers for all implementation, including pin, policy, publication/lifetime and Settings; only Task 8's mechanical documentation may use `sonnet`/`medium`. Per-task reviewers `opus`/`high` on Tasks 4, 5, 6, 7 and 9, `sonnet`/`high` on Tasks 2 and 3, `sonnet`/`medium` on Task 8; Task 10's held-out whole-branch pass on three `opus`/`high` lenses (correctness, spec/boundaries, reproduction/evidence); each critical/important finding gets three independent `sonnet`/`high` refuters and majority adjudication, each minor gets one advisory refuter; every subagent's `model` passed explicitly (never inherited, never Fable); workflows off. Subagent prompts forbid mail, pattern kills, any `gh` write verb, any token in an argv and approval-prompting shell forms.
- **Worker flow:** ack; Tasks 1-9 with native subagents; questions to the operator as structured asks; mail listed before every push and before the wave-done. Escalation: a Task 1 base condition; a Find block that misses; a published package whose integrity differs from the brief's or whose attestation fails (Task 2); a measured red outside its row's prediction (reported); a row that stays green (stop-and-ask); the one-bar figure over 61 px or the console's part over 48 px (Task 7); a tablet or desktop figure that moved from BASE by more than 1 px (Task 7). Task 10 closes.
- **Review:** on a verified wave-done the coordinator dispatches one independent `ccrc-reviewer` run at the measured tip. Three held-out `opus`/`high` lenses cover correctness; spec/boundaries; reproduction/evidence. All cover the pin/three draw paths and unchanged lab instrument, one-bar truth/interaction/layout, Settings access and modified clicks, tests/mutations/censuses/spec/privacy. Critical/important findings receive three `sonnet`/`high` refuters with majority adjudication; minor findings receive one advisory refuter. Record actual model identities: a missing, dead or mismatched lens is unverified, not approval. Worker internal review is additional, never this gate.
- **Merge gate:** the operator's answers to Q1 to Q3; every row red as measured; the browser figure at 412 x 915 at or under 61 px and the console's part at or under 48 px, recorded in `## Results` beside BASE; tablet and desktop figures within 1 px of BASE; the provenance check green locally and in `build-pwa`; Task 9's two diagnostic doors and normal/modified-click cases green; the reviewer's report accepted; the PR's required checks green, and actual `browser (pwa)` execution green in the merge queue.
- **After the merge:** the merge becomes a prerelease. The completion plan's F wave owns operator rollout and installed-build/device verification, including the two Settings doors. A new-build lab run names `6bcf14892e48` and still measures `auto`, not after-ready (refinement (d)); the old blocks cannot prove the installed build.

## Review Focus

| Input | What could go wrong | Pinned by |
|---|---|---|
| The E17 reading: holds, does not hold, not measured, two blocks that disagree | draw on open shipped on a reading that did not hold; the lab's instrument silently changed | `docsDrawFor`'s table and the recorded reading's pin (L11-T3-M1, M2); the lab profile's arm (L11-T3-M3, L11-T4-M7, M9) |
| The draw mode: after ready, on request, on open (the lab) | the Docs reader still waiting for the Mermaid chunk before the mount; the lab losing its D-8030 report; the on-request arm losing its scan drop | the three-path cases (L11-T4-M1, M2, M7) and the kept W8a cases |
| The bar: a mount at 412, at 599, at 600 and up; a phone widened after the mount | the frame's bar off on a desktop; a phone with no reachable quick jump; tools that vanish on rotation | `readerChromeFor` (L11-T3-M4), the bridge's host-bar condition (L11-T4-M10), the slot read at the mount (L11-T5-M1), `headLayoutFor`'s table (L11-T6-M1, M11), the browser's widened case |
| The frame's states: formatting, ready, fallback after ready, Export's plain view, unmount | the one bar shown before commands work, or left after the frame is gone | the publish-on-ready and withdraw cases (L11-T5-M2, M3), the head's fallback and plain-view cases |
| A tap on a tool | a command run after the tap's gesture, which the library documents as a toggle that no longer closes | the synchronous-command case (L11-T6-M2) and the browser's toggle case |
| The title: a document with an h1, with none | the bar reading the file name when the document has a title, or nothing | `readerBarTitle` (L11-T3-M6), the publish case (L11-T5-M4) |
| Keyboard and screen reader | a title button whose name hides the freshness problem; focus lost when the panel closes | the name case (L11-T6-M6), the Escape cases (L11-T6-M3, M4) |
| The figure and the box | a reading line that adds height; a bar over one tap; Aa over the title | the browser's figure and box cases, Aa's overlap recorded as a figure |
| Settings navigation | a diagnostic absent, misrouted, counted as an ordinary section, or hijacking modified clicks | Task 9's independent door cases and two mutations, command/route integration |

## File Structure

| File | Task | Ring | Responsibility |
|---|---|---|---|
| `pwa/package.json`, `pwa/package-lock.json` | 2 | — | the exact pin at 1.1.0 |
| `pwa/test/reader-pin.test.ts` | 2 | — | the pin, the lock, the installed manifest, and 1.1.0's moved hashes |
| `pwa/src/docs/reader/policy.ts` | 3 | L1 | `ReaderE17Reading`, `READER_E17_MERMAID`, `docsDrawFor`, `ReaderChrome`, `readerChromeFor`, `ReaderMountPlan.chrome`, `readerMountPlan(profile, bytes, chrome, e17)`, `ReaderCommand`, `oneBarTools`, `readerBarTitle` |
| `pwa/test/reader-policy.test.ts`, `pwa/test/reader-commands.test-d.ts` (new) | 3 | — | the decisions; `ReaderCommand` equal to the library's command type |
| `pwa/src/docs/reader/bridge.ts` | 4 | L3 | the three Mermaid paths; `features`, `onProgress`; `command`; `deps.e17` |
| `pwa/test/reader-bridge.test.ts`, `pwa/test/reader-lab-bridge.test.ts`, `pwa/test/reader-lab-window.test.ts` (new) | 4 | — | the adapters per arm; the lab's path; the lab's window |
| `pwa/src/readerLab/run.ts` | 4 | L4 | one comment (refinement (d)) |
| `pwa/src/docs/readerBar.ts` (new) | 5 | L4 | `ReaderBar`, `ReaderProgress`, `ReaderBarSlot`, `ReaderBarContext`, `createReaderProgress`, `usePublishReaderBar` |
| `pwa/src/docs/ReaderFrame.tsx` | 5 | L4 | the bar asked for at the mount; progress; the bar published at ready |
| `pwa/src/screens/DocsScreen.tsx` | 5 | L4 | the slot: the chrome from the width, the bar handed to the head |
| `pwa/test/reader-frame.test.tsx` | 5 | — | the publication |
| `pwa/src/docs/docsHeadWords.ts` | 6 | L1 | the existing sole owner of `headLayoutFor`; add its third answer here |
| `pwa/src/docs/DocsHead.tsx` | 6 | L4 | `OneBar`, `ReadLine`, `CompactWhere`, `moreName`; preserve HeadRow and its existing decider import |
| `pwa/src/docs/docsText.ts`, `pwa/src/docs/docs.css`, `pwa/design/audit.mjs` | 6 | words, stylesheet, contrast census | `DOCS_TOOL_TEXT`; the one bar's rules; two grounds |
| `pwa/test/docs-one-bar.test.tsx` (new), `docs-compact-head.test.tsx`, `docs-compact-css.test.ts`, `tap-targets.test.tsx`, `control-census.test.ts` | 6 | — | the one bar's markup, its table, its declarations, both tap halves, two controls |
| `pwa/browser/docs-compact-head.browser.test.ts`, `pwa/browser/reader-frame.browser.test.ts` | 1 (BASE), 7 | — | the figure, the bar, the commands, the progress in Chromium; the draw rows by the recorded arm |
| the three specs | 8 | — | the amendments |
| `pwa/src/screens/settings/SettingsIndex.tsx` | 9 | L4 | two existing diagnostic doors after the five ordinary section rows |
| `pwa/test/settings-frame.test.tsx`, `settings-screen.test.tsx`, `command-layer.test.tsx`, `command-registry.test.ts` | 9 | — | ordinary sections unchanged; diagnostic names, hrefs, commands, click semantics and route integration |

## Refinements (decided while planning)

Each says What, Why and Cost if wrong, and whether it departs from a spec or design sentence. One departs: (d).

- **(a) The pin moves to 1.1.0 and nothing is re-pinned by hand, because ccrc pins nothing by hand.**
  - What: `pwa/package.json` and the lock at exactly 1.1.0 (`npm install --save-exact`); `reader-pin.test.ts`'s five 1.0.0 assertions become 1.1.0, and one case pins what moved: the installed `assets/assets.json` records the four moved hashes the library's CHANGELOG names (`frame/bootstrap.js` `dc49ce7d…459c424`, `frame/enhance.js` `6bcf1489…070eb64`, `frame/reader.css` `b065ff8f…f5c97`, `reader.css` `96430753…22eeb5`) and the three that did not (`frame/guard.js` `ff3c25da…bda65c4d`, `mermaid/mermaid.frame.js` `7585b205…8832c3`, `mermaid/mermaid.mjs` `dfba66fc…626b38df`). M8.16 runs unchanged (it reads the lock), and Task 2 runs it locally once.
  - Why: the CHANGELOG's warning is for a host whose page policy lists the frame's script hashes; ccrc's shell lists none (`frame-src 'none'` only) and derives every frame hash from `FRAME_MANIFEST`. The one literal case makes a bump state, in the tree, which assets it moved.
  - Cost if wrong: the literal case is one more edit at every bump, which is the point.
  - Departs from no sentence (M8.12, M8.16 hold as written).
- **(b) One recorded E17 reading decides the Docs reader's draw.**
  - What: `READER_E17_MERMAID: ReaderE17Reading` in `policy.ts`, with the block's head line and `mermaid` line quoted in its docstring, and `docsDrawFor(e17)`: `after-ready` for `holds`, `on-request` for `does-not-hold` and `not-measured`. The reading is `holds` only when every block the operator sent reads `holds` on its `mermaid` line; `does-not-hold` when any reads `does not hold`; otherwise (no block, or a block that reads `not measured`) `not-measured`. A test pins the recorded value, so a flip is a deliberate edit that reds it. The `busy-frame` line is recorded as a fact and decides nothing (E17's own pass cell).
  - Why: the rich-docs spec makes drawing on open follow E17 (§4.6, amended 2026-11-03); the operator's ruling is draw on open, so the condition is the measurement and nothing else. One constant means a later block (a second engine, a re-run on 1.1.0) moves the reader with one edit, its pin and the spec's E17 sentence.
  - Cost if wrong: if the block holds on the operator's phone but a second, slower phone stalls, that phone stalls while figures draw; it never stalls before `ready` and the page stays readable. Q1 offers the stricter and looser rules.
  - Departs from no sentence.
- **(c) The bridge keeps three Mermaid paths, one per draw.**
  - What: drawn **after `ready`** (the Docs reader when E17 held), the bridge awaits nothing for Mermaid: it hands the library `loadMermaid` (the same `?raw` loader, `deps.mermaid ?? loadMermaidAsset`, by identity), keeps the scan, and never reports a drop; the library calls the loader at mount, in parallel with the frame's boot, only for a document its gate admits, and a loader that fails leaves every figure as its source with the load note. Drawn **on request** (the Docs reader otherwise) or **on open** (the lab's `lab-draw`, `auto`), the bridge keeps W8a's pre-mount load inside the watchdog and its scan drop, and reports the drop through `onMermaidDrop` for `auto` only (D-8030). `loadMermaid` is passed only after `ready` (in any other mode the library ignores it).
  - Why: the take-up's core list ("delete its pre-mount await on the Mermaid chunk and its scan-drop") applies to the mode that needs neither; the other two modes inline the text, so they still need it before the mount, and the lab's window and its "not measured" reading (D-8030) need the drop report. A test per path pins which path a draw takes.
  - Cost if wrong: none to behaviour; a later removal of the on-request arm is one branch.
  - Departs from no sentence.
- **(d) The reader lab stays the E17 instrument, unchanged: `lab-draw` keeps the library's `auto` mode and its gap window stays `ready`.** **Departure.**
  - What: `readerMountPlan('lab-draw', …)` stays `{ draw: 'auto', …, chrome: 'frame-bar' }` whatever the reading and bar; `LAB_GAP_WINDOW` stays `'ready'`. Replace its obsolete comment and hold the two with `reader-lab-window.test.ts`. The instrument remains comparable with the two blocks in hand, but neither those blocks nor a new auto run measures after-ready.
  - Why: 1.1.0 added after-ready as a third mode and left auto unchanged; ready still waits for figures in auto. Keeping the instrument preserves what the supplied blocks actually measured. Similar rendering work does not prove equal scheduling gaps or a cross-build upper bound. The failed block conservatively keeps production on request; no such equivalence is needed.
  - Cost if wrong: this instrument cannot establish an after-ready timing claim. A future draw flip must name the released build, actual mode and a window covering its draw, apply the existing all-blocks rule and retain every failure. This take-up does not introduce that lab profile or claim that measurement.
  - **Departs from** the reader lab design's automatic window-flip commitments: RL14, the §8 bullet and Later. Task 8 corrects all of those in place, including the obsolete §8 re-measure premise. It does **not** waive the rich-docs E17 requirement to measure the shipped draw mode: Task 8 records the two auto/1.0.0 blocks with their limits, while production stays on request. Task 10's issued deviation entry names these exact sentences and the missing after-ready measurement, not a fabricated equivalence.
- **(e) Nothing else of the lab moves.** `lazyMountReader` keeps its signature; the lab never sees the new slot (it does not mount through `ReaderFrame`), so its mounts keep the frame's own bar and ask for no progress; their `command` member exists (every live mount has one) but the lab never calls it; its adapter set stays the twelve keys it has today (W8a's fourteen less `store` and `docKey`). `READER_LIBRARY_BUILD` moves with the enhance hash, as it was built to. Departs from no sentence.
- **(f) The one bar replaces option 1's row on a leaf whose reader frame takes commands; option 1 stays everywhere else on a phone.**
  - What: `headLayoutFor(compactWidth, page, takesCommands)` answers `one-bar` on a leaf when `takesCommands` (a frame on this page is ready and was mounted with ccrc's bar), `compact` on a leaf at the compact width otherwise, and `full` everywhere else. A frame is mounted with ccrc's bar only when the compact width matches as its mount starts (`readerChromeFor`), and keeps that bar for its life: a phone turned sideways, or a window widened, after the mount keeps the one bar, so the frame's tools stay reachable; one mounted at 600 px or wider keeps the frame's own bar and the full header, as today, and gets option 1's row if it is later narrowed (its frame takes no commands). Option 1's row therefore stays on a phone for a leaf whose body is not a ready host-bar frame: while "Formatting…" shows, after a fallback, in Export's plain view (choosing it unmounts the reader, which withdraws the bar, so the row returns with the plain-view note under it), on an image, text or other leaf, behind the render gate's prompt, and where the browser has no `Worker`. The head swaps from the row to the one bar at `ready`; both are one tap tall with the 4 px gap under them, so the frame does not move.
  - Why: the operator picked option 2 "with the library release" for the phone; the mockup and the header plan both keep desktop and tablet unchanged. The frame's chrome is fixed by its seed at mount, and ccrc never remounts for a width (§4.1), so the bar that was mounted decides the head.
  - Cost if wrong: on a page whose reader starts, the row's contents change at `ready` (the label's file name becomes the title, Share and Export leave for the panel, the tools arrive): visible once per page. A desktop window narrowed under 600 keeps the frame's own bar under option 1's row until the page is reopened.
  - Departs from no sentence once Task 8's base-spec amendment lands (§4.4's Layout sentence is amended to say this).
- **(g) ccrc's bar: the frame's bar off, its top space trimmed, progress asked for.**
  - What: a host-bar mount passes `features: { chrome: { bar: false, topSpace: false } }` (a fresh plain object) and `onProgress`; nothing else of `features` (rules, folds, keyboard, rail, settings, vocabulary stay the library's defaults). A frame-bar mount passes neither, as today.
  - Why: `bar: false` is the switch the library made work in 1.1.0 (item C); `topSpace: false` trims the root's top padding to 8 px for a root with no bar (the library's Q8), and ccrc's bar is the space above the text: predicted 44 + 4 + 8 = 56 px above the title, against the mockup's 61 (trimmed) and 81 (not). `onProgress` is what asks the frame to send progress at all.
  - Cost if wrong: if the 8 px reads cramped on the phone, `topSpace` is one value (28 px on a phone without it, about 76 px above the title).
  - Departs from no sentence.
- **(h) The title is the document's own; the file name is the fallback.**
  - What: `readerBarTitle(result.meta.title, leafName(path))`: the parse's first level-1 heading when it is a non-blank string, else the file name ccrc already shows (the frame's accessible name). Above it, the title button keeps option 1's first line (`CompactWhere`: the parent crumb, a served ref that is not origin/HEAD, a draft's badge), and the freshness dot sits before the title text.
  - Why: the library's Q9 (no title op; `result.meta.title` is the frame's title byte for byte); the header plan's refinement (g) (goal 4 at a glance) and its Later ("`freshDot` and its names move beside the title unchanged").
  - Cost if wrong: a document whose h1 is long ends in an ellipsis; the full title is the h1 directly below.
  - Departs from no sentence.
- **(i) The bar's handle reaches the head through one slot, published at `ready` and withdrawn when the frame goes.**
  - What: `docs/readerBar.ts`, the `ExportBodyContext` pattern: `DocsScreen` provides `ReaderBarContext` = `{ chrome: readerChromeFor(compactWidth), publish: setReaderBar }` and hands `readerBar` to `DocsHead`. `ReaderFrame` reads the slot's `chrome` when its mount starts, passes it and, for a host bar, an `onProgress` that feeds a small store (`createReaderProgress`); once the frame is `ready` it publishes `{ title, command, progress }`, and withdraws it (`null`) when the frame falls back or the body unmounts. `ReaderMount` gains `command?(name)`: the bridge's live mount has it and forwards to `DocFrame.command` at once (nothing after `destroy`); the inert mount of a failed asset load has none. Progress never passes through React state above the head: only the reading line subscribes.
  - Why: the head and the frame are siblings under `DocsScreen`, which already holds Export's body this way; a slot the lab never sees keeps the lab's mounts byte-for-byte as they are; four progress reports a second re-render one span, not the screen. `command` is optional because a required member would red `reader-lab-run.test.ts`'s `satisfies ReaderMount` fake, a file this wave leaves alone (Global Constraints, Residue).
  - Cost if wrong: none to behaviour; making `command` required later is one edit and that test's fake.
  - Departs from no sentence.
- **(j) The one bar draws Quick jump and Contents, and Outline on a plan's page; Aa stays the frame's own.**
  - What: `oneBarTools(section)`: `['jump', 'contents']`, and `['jump', 'contents', 'outline']` on a `plans` leaf, in the frame's own bar's order; each a `<button class="docs-tool">` with an `Icon` and its `DOCS_TOOL_TEXT` word as its accessible name, whose click runs `bar.command(name)` synchronously. The reading settings (Aa) stay the frame's own button, which the library draws at the frame's top right when the bar is off (`chrome.settings` stays true, so the reading settings keep working). No `aria-expanded` on the tools: the frame reports no overlay state (the library's CR2, Later).
  - Why: a command must run from the button's own click handler for the second press to close what the first opened (the library's README, `runEnhancementCommand`). With `settings` on, the library always draws its own Aa, and `chrome.settings: false` would remove the reading settings altogether, so a ccrc Aa button could only duplicate it (Q2). Outline: the host cannot know whether a plan takes the outline (the library's own step threshold), so the button is on every plans leaf and does nothing on a short plan; elsewhere it would do nothing on most documents. The three icons are already vendored, so nothing is fetched.
  - Cost if wrong: on a short plan, or a document with no contents rail, a tool tap changes nothing (the library answers nothing); a "tools available" report is Later. The icons are generic (`search` is also the command palette's).
  - Departs from no sentence.
- **(k) The details panel is option 1's disclosure, opened by the title, holding the full header's actions.**
  - What: the title is a `<button class="docs-title">` with `aria-expanded` and `aria-controls`, controlling the same `docs-more-panel` region option 1 draws in the page's flow (`hidden` while closed, Escape inside either closes it and returns focus to the title, a navigation closes it). The panel holds the crumbs (every one a link), `TruthLine` and the full header's own `Actions` line (View on GitHub, Share, Export, Open committed version, in §4.5's order, with their visible words); "Updated to" stays under the bar, outside the panel. The one bar draws no plain-view note: choosing Export's plain view unmounts the reader, which withdraws the bar, so that note is under option 1's row (refinement (f)). No ⋯ button and no menu. The title button's accessible name is its visible text followed by option 1's Page details words (`moreName(dot)`: "Page details", "Page details (never fetched)", "Page details (freshness problem)") in a visually hidden span.
  - Why: the header plan's Later ("option 2's details sheet, opened by tapping the title, holds the same block") and the operator's Q2 of that plan (a disclosure in the page's flow, not a floating menu). Moving Share and Export into the panel gives the title the row's room (the tools take it), and restores §4.5's order and words inside the panel.
  - Cost if wrong: Share and Export are two taps on a phone reader page (the mockup's ⋯ menu was two taps as well). **A deliberate departure from the picked mockup**, whose ⋯ opened a menu of View on GitHub, Share, Export and Document details: Q3.
  - Departs from no spec sentence.
- **(l) The reading line is drawn by ccrc along the bar's bottom edge.**
  - What: `<span class="docs-read" aria-hidden="true">` inside the bar, 2 px tall at its bottom edge and inside its 44 px (absolutely placed over the 1 px divider: an absolute box is placed against the bar's padding box, which ends above the divider, so `inset-block-end: -1px` brings the line's bottom to the bar's), `background: var(--accent)`, its inline size the share as a percentage (the `ProgrammeBox` progress idiom), no transition and no opacity. It reads the progress store through `useSyncExternalStore`, so only it re-renders.
  - Why: the mockup ("its 2 px progress line is drawn by the console under the bar"); the library's own line is 2 px of the accent at 0.7 opacity, and a static opacity would be one more registered fade (the contrast census's `OPACITY_REGISTRY`), so ccrc draws the accent whole. Decorative, like the library's: the frame itself is the scrolled region.
  - Cost if wrong: none to the figure (inside the bar's height); a progress bar for assistive technology is a later choice.
  - Departs from no sentence.

### Task 1: Base, claims, the release, the E17 reading and the BASE figures

**Model routing:** the main loop.

**Files:** none edited. SDD ledger: `.superpowers/sdd/2026-11-05-native-docs-reader-library-1-1-take-up/progress.md` (gitignored).

- [ ] **Step 0: Base and finds.** Run, from the repository root:
  `git grep -q '"@synapsium-labs/docserver": "1.0.0"' HEAD -- pwa/package.json && git grep -q "draw: 'on-request', watchdogMs: readerWatchdogMs(bytes), store: true" HEAD -- pwa/src/docs/reader/policy.ts && git grep -q "export const LAB_GAP_WINDOW: LabGapWindow = 'ready';" HEAD -- pwa/src/readerLab/run.ts && git grep -q "export type HeadLayout = 'full' | 'compact';" HEAD -- pwa/src/docs/docsHeadWords.ts && git grep -q "content=\"frame-src 'none'\"" HEAD -- pwa/index.html && echo T1-BASE-OK`
  Expected: `T1-BASE-OK`. Then the find-check (the coordinator's script, as used for the header and lab plans): every `Find (...)` block in this plan matches its file exactly once — expected `FINDS-OK`. A miss is a stop-and-ask. Record BASE (`git rev-parse HEAD`) in the SDD ledger. Confirm the claims.
- [ ] **Step 1: The published release, read-only.** `npm view @synapsium-labs/docserver@1.1.0 version dist.integrity dist.tarball` — expected `1.1.0`, a `sha512-` integrity equal to the brief's, and the registry tarball URL. `gh release view v1.1.0 --repo Synapsium-Labs/docserver --json tagName,isPrerelease,publishedAt` — expected the tag. Any difference is a stop-and-ask, before any file is claimed.
- [ ] **Step 2: The E17 reading.** From the brief, copy into the SDD ledger, for each block: its first line (`reader-lab 1 · … · library <build>`), its `E17 responsive` line, its `busy-frame` line, its `mermaid` line, its `gaps ms` line and its `draw on open:` line, verbatim. Decide the reading by refinement (b): `holds` only if every block's `mermaid` line reads `holds`; `does-not-hold` if any reads `does not hold`; else `not-measured` (also when the brief carries the operator's Q1 answer that there is no block). Record it as `E17-READING <holds|does-not-hold|not-measured>`, and the number of blocks as `E17-BLOCKS <n>` (`0` when the brief carries the operator's Q1 answer that there is none). The rest of this plan calls the two arms **arm A** (`holds`: the Docs reader draws after `ready`) and **arm B** (otherwise: it draws on request, as today). Task 3's docstring and Task 8's spec text split arm B once more, by whether a block arrived: **arm B with a block** (`E17-BLOCKS` 1 or more) and **arm B with no block** (`E17-BLOCKS 0`).
- [ ] **Step 3: The BASE figures.** Through `ccrc test`, at BASE: `browser/docs-compact-head.browser.test.ts` (whole file) and `browser/reader-frame.browser.test.ts -t "the worst case"`. Copy every `PHH-FIGURE` line and the `T10-FIGURES worst` line into the SDD ledger as BASE. They are the before figures of `## Results`; nothing is asserted against them but the tablet and desktop deltas (Task 7).

**Verify:** `T1-BASE-OK`, `FINDS-OK`, the release read, `E17-READING` recorded, the BASE figures recorded. No commit.

### Task 2: The exact pin at 1.1.0, every W8a guard carried (refinement (a); M8.12, M8.16)

**Model routing:** `sonnet`, effort `high`; per-task reviewer `sonnet`/`high`.

**Files:**
- Modify: `pwa/package.json` (one line), `pwa/package-lock.json` (npm's four lines: the root's dependency line and the entry's `version`, `resolved` and `integrity`), `pwa/test/reader-pin.test.ts`.
- Guards (not edited): `pwa/test/reader-assets.test.ts`, `pwa/test/reader-built.test.ts`, `pwa/test/reader-bridge.test.ts`, `pwa/test/reader-lab-bridge.test.ts`, `pwa/test/w7-storage-keys.test.ts`, `pwa/test/reader-policy.test.ts`, `pwa/test/markdown-purity.test.ts`, `server/test/docs-parity.test.ts`, `server/test/ci-pipeline.test.ts`.

**Interfaces:** none. The bridge and the policy are unchanged here, so the reader still draws on request and the lab on open, both of which 1.1.0 keeps; the commit is green by itself.

- [ ] **Step 1: The pin test, red first.** In `pwa/test/reader-pin.test.ts`, replace every `1.0.0` with `1.1.0` (the five `toBe('1.0.0')` assertions, the `resolved` URL's `docserver-1.0.0.tgz`, and the four case names that say `1.0.0`), and append one case to the describe:
  - `'the installed assets manifest records 1.1.0\'s moved hashes and keeps the three that did not move'`: reads `node_modules/@synapsium-labs/docserver/assets/assets.json`'s `files` (`{ path, sha256 }`), and expects, by `path`: `frame/bootstrap.js` `dc49ce7dffeb1d2f9ebba065ec6a53ecbdf3ab1439f67c63c17763dda459c424`; `frame/enhance.js` `6bcf14892e483f442f701c0ca9ff521c86e482c219485102b81927db9070eb64`; `frame/reader.css` `b065ff8f9e7d20cfd39bd33b9d4be8414554d4c2bfec8d18636efecad83f5c97`; `reader.css` `9643075331610addc88df72d55289be749fb4c991607c96c22f7bde63e22eeb5`; `frame/guard.js` `ff3c25da5703bc06d40ca0412b2e760c619a73a4153306f4d0f3b662bda65c4d`; `mermaid/mermaid.frame.js` `7585b2055ba386b9acff71b9c8a0c40b36dec79c2106a4aa56048c8fe59832c3`; `mermaid/mermaid.mjs` `dfba66fc5c75e030c35bf16d5e7a62bbee7be5496cabec94ec93f85d626b38df` (the CHANGELOG's 1.1.0 and 1.0.0 entries).
  Run `( cd pwa && ./node_modules/.bin/vitest run test/reader-pin.test.ts )` — Expected (prediction): `5 failed | 1 passed (6)` (the highlight.js case stays green).
- [ ] **Step 2: Bump.** `( cd pwa && npm install --save-exact @synapsium-labs/docserver@1.1.0 )`. Then `git diff --stat -- pwa/package.json pwa/package-lock.json` — expected 1 line in the manifest and the lock's root line plus its entry's `version`, `resolved` and `integrity`, nothing else (`git diff -U0 -- pwa/package-lock.json` shows only `@synapsium-labs/docserver` lines). The entry's `integrity` equals Step 1 of Task 1's. A wider lock diff is a stop-and-ask.
- [ ] **Step 3: The provenance check, locally.** From the repository root: `bash .github/ci/library-provenance.sh` — expected its two lines, "the packed tarball matches the lock's integrity" and "… @synapsium-labs/docserver@1.1.0 was built by Synapsium-Labs/docserver/.github/workflows/release.yml at refs/tags/v1.1.0". Then `( cd pwa && ../.github/ci/bounded.sh 180 npm audit signatures )` — expected every signature verified. A failure is a stop-and-ask.
- [ ] **Step 4: Green.** `reader-pin` 6 passed. Then, through `ccrc test`: `test/reader-assets.test.ts test/reader-bridge.test.ts test/reader-lab-bridge.test.ts test/w7-storage-keys.test.ts test/reader-policy.test.ts test/markdown-purity.test.ts test/reader-built.test.ts` — expected each at its BASE count (they read the installed manifest, so the moved hashes move with them). `TSC-OK`. `( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts test/ci-pipeline.test.ts )` — BASE counts.
- [ ] **Step 5: Commit.** `git add pwa/package.json pwa/package-lock.json pwa/test/reader-pin.test.ts` (expect 3), message `pwa: pin the shared Markdown library at exactly 1.1.0 (docs library 1.1 take-up)`, trailer.

**Mutation rows this task contributes** (pkg `pwa`):

| id | spec | file | old → new | tests | expected red (prediction) |
|---|---|---|---|---|---|
| L11-T2-M1 | (a) M8.12 | `package.json` | `"@synapsium-labs/docserver": "1.1.0",` → `"@synapsium-labs/docserver": "^1.1.0",` | `test/reader-pin.test.ts` | 1 failed — `'pwa/package.json pins @synapsium-labs/docserver at exactly 1.1.0'` |
| L11-T2-M2 | (a) | `node_modules/@synapsium-labs/docserver/assets/assets.json` | `"sha256": "dc49ce7dffeb1d2f9ebba065ec6a53ecbdf3ab1439f67c63c17763dda459c424",` → `"sha256": "dc49ce7dffeb1d2f9ebba065ec6a53ecbdf3ab1439f67c63c17763dda459c425",` | `test/reader-pin.test.ts` | 1 failed — the moved-hashes case |

```json
[
  {"id": "L11-T2-M1", "spec": "(a) M8.12", "pkg": "pwa", "file": "package.json", "old": "\"@synapsium-labs/docserver\": \"1.1.0\",", "new": "\"@synapsium-labs/docserver\": \"^1.1.0\",", "tests": ["test/reader-pin.test.ts"], "red": "1 failed: pwa/package.json pins @synapsium-labs/docserver at exactly 1.1.0"},
  {"id": "L11-T2-M2", "spec": "(a)", "pkg": "pwa", "file": "node_modules/@synapsium-labs/docserver/assets/assets.json", "old": "\"sha256\": \"dc49ce7dffeb1d2f9ebba065ec6a53ecbdf3ab1439f67c63c17763dda459c424\",", "new": "\"sha256\": \"dc49ce7dffeb1d2f9ebba065ec6a53ecbdf3ab1439f67c63c17763dda459c425\",", "tests": ["test/reader-pin.test.ts"], "red": "1 failed: the installed assets manifest records 1.1.0's moved hashes"}
]
```

**Verify:** `reader-pin` 6 passed; the guards at BASE; the provenance check and `npm audit signatures` green; `TSC-OK`.

### Task 3: The reader's decisions: the E17 reading, the bar, the tools and the title (refinements (b), (d), (f), (g), (h), (j); L1)

**Model routing:** `sonnet`, effort `high`; per-task reviewer `sonnet`/`high`.

**Files:**
- Modify: `pwa/src/docs/reader/policy.ts` (one Find), `pwa/test/reader-policy.test.ts` (one appended describe and one import), `pwa/test/reader-bridge.test.ts` (the lab profile's two `readerMountPlan` calls take the new arguments).
- Create: `pwa/test/reader-commands.test-d.ts`.
- Guards (not edited): `server/test/rings/pwa-rings.test.ts`, `pwa/test/reader-lab-scans.test.ts`.

**Interfaces:** Produces `ReaderE17Reading`, `READER_E17_MERMAID`, `docsDrawFor`, `ReaderChrome`, `readerChromeFor`, `ReaderMountPlan` (with `chrome`), `readerMountPlan(profile, bytes, chrome, e17)`, `ReaderCommand`, `oneBarTools`, `readerBarTitle`.

- [ ] **Step 1: Tests, red first.** Append to `pwa/test/reader-policy.test.ts` a describe `'the library 1.1 take-up: the reader\'s decisions (the take-up plan, Task 3)'`, importing the new names from `../src/docs/reader/policy` and `READER_LAB_DRAW_WATCHDOG_MS` from `../src/lib/readerLimits`:
  1. `'docsDrawFor draws after ready only when the E17 Mermaid line holds'`: `holds` → `after-ready`; `does-not-hold` and `not-measured` → `on-request`.
  2. `'READER_E17_MERMAID is the reading the operator\'s block gave'`: `expect(READER_E17_MERMAID).toBe(<E17-READING>)`, the literal Task 1 Step 2 recorded.
  3. `'readerMountPlan: the Docs reader draws as the reading says and has the bar it asked for'`: for each of the three readings and both chromes, `readerMountPlan(undefined, 100, chrome, e17)` equals `{ draw: docsDrawFor(e17), watchdogMs: readerWatchdogMs(100), store: true, chrome }`.
  4. `'readerMountPlan: lab-draw draws on open in the auto mode, on the frame\'s own bar, whatever the reading and the bar asked for'`: for each reading and both chromes, `readerMountPlan('lab-draw', 100, chrome, e17)` equals `{ draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome: 'frame-bar' }`.
  5. `'readerChromeFor: ccrc\'s bar at the compact width, the frame\'s own bar otherwise'`.
  6. `'oneBarTools: the quick jump and the contents; a plan\'s Outline on a plans leaf; never the reading settings'`: `specs`, `product-design`, `conventions` → `['jump', 'contents']`; `plans` → `['jump', 'contents', 'outline']`; no answer contains `settings`.
  7. `'readerBarTitle: the document\'s first level-1 heading, else the file name'`: `('Path identity design', 'a.md')` → the heading; `(null, 'a.md')` and `('  ', 'a.md')` → `'a.md'`.
  Create `pwa/test/reader-commands.test-d.ts`:
```ts
// ccrc's command names are the library's (the take-up plan, refinement (j)): `./frame` exports no list of them, so the
// type DocFrame.command takes is the reference, held equal both ways.
import type { DocFrame } from '@synapsium-labs/docserver/host';
import { expectTypeOf, test } from 'vitest';
import type { ReaderCommand } from '../src/docs/reader/policy';

test('ReaderCommand is the name type DocFrame.command takes', () => {
  expectTypeOf<ReaderCommand>().toEqualTypeOf<Parameters<DocFrame['command']>[0]>();
});
```
  In `pwa/test/reader-bridge.test.ts`'s lab-profile describe, the case `'readerMountPlan is the one decision, and only lab-draw maps to drawing on open'` becomes (Find, origin/main `ce55b1ca9`):
```ts
    expect(readerMountPlan('lab-draw', 100)).toEqual({ draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false });
    expect(readerMountPlan(undefined, 100)).toEqual({ draw: 'on-request', watchdogMs: readerWatchdogMs(100), store: true });
```
  Replace:
```ts
    expect(readerMountPlan('lab-draw', 100, 'frame-bar', 'holds'))
      .toEqual({ draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome: 'frame-bar' });
    expect(readerMountPlan(undefined, 100, 'frame-bar', 'does-not-hold'))
      .toEqual({ draw: 'on-request', watchdogMs: readerWatchdogMs(100), store: true, chrome: 'frame-bar' });
```
  Run `( cd pwa && ./node_modules/.bin/vitest run test/reader-policy.test.ts test/reader-commands.test-d.ts )` — Expected: fails to import (the names do not exist).
- [ ] **Step 2: The policy.** Find (origin/main `ce55b1ca9`, `pwa/src/docs/reader/policy.ts`):
```ts
/** The frame's start watchdog for a document of `bytes` UTF-8 bytes: the Docs parse budget, with no allowance for
 *  Mermaid (the W8a plan's refinement (c): `ready` does not wait for it in on-request mode). */
export function readerWatchdogMs(bytes: number): number {
  return DOCS_PARSE_BUDGET_MS(bytes);
}

/** Who mounts (the reader lab plan, refinement (k)): no profile is the Docs reader; `lab-draw` is the reader lab's timed
 *  mount, and only the lab passes it. */
export type ReaderMountProfile = 'lab-draw';

/** How one mount draws, waits and stores. */
export interface ReaderMountPlan {
  readonly draw: 'auto' | 'on-request';
  readonly watchdogMs: number;
  /** Whether the mount is handed the reader's storage port. */
  readonly store: boolean;
}

/** The one decision: the Docs reader draws Mermaid on request, waits `readerWatchdogMs(bytes)` and keeps reader state;
 *  the reader lab's `lab-draw` draws on open, waits READER_LAB_DRAW_WATCHDOG_MS and keeps none, so the lab stores
 *  nothing. */
export function readerMountPlan(profile: ReaderMountProfile | undefined, bytes: number): ReaderMountPlan {
  return profile === 'lab-draw'
    ? { draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false }
    : { draw: 'on-request', watchdogMs: readerWatchdogMs(bytes), store: true };
}
```
  Replace (`READER_E17_MERMAID`'s value and docstring are Task 1 Step 2's: the worker writes the literal it recorded, quoted, in place of `'<E17-READING>'`, and in place of the angle-bracketed docstring sentence each block's first line and `mermaid` line, verbatim, with the date the operator sent it; in arm B with no block, the sentence `No block had arrived when the take-up landed (the operator's answer to the take-up plan's Q1).` instead. Step 3 checks that neither placeholder reached a file):
```ts
/** The frame's start watchdog for a document of `bytes` UTF-8 bytes: the Docs parse budget, with no allowance for
 *  Mermaid: `ready` waits for it neither on request (the W8a plan's refinement (c)) nor after `ready` (the library 1.1
 *  take-up plan, refinement (c)). */
export function readerWatchdogMs(bytes: number): number {
  return DOCS_PARSE_BUDGET_MS(bytes);
}

/** Who mounts (the reader lab plan, refinement (k)): no profile is the Docs reader; `lab-draw` is the reader lab's timed
 *  mount, and only the lab passes it. */
export type ReaderMountProfile = 'lab-draw';

/** What the reader lab's E17 `mermaid` line read (the take-up plan, refinement (b)), in the lab's own words for that
 *  line's three outcomes. Mirrors the lab's verdicts; nothing is imported from the lab. */
export type ReaderE17Reading = 'holds' | 'does-not-hold' | 'not-measured';

/** The reading this build's draw was decided on (the take-up plan, refinement (b)): every block the operator sent reads
 *  `holds` on its `mermaid` line, or one reads `does not hold`, or none was measured. <Each block's first line and its
 *  `mermaid` line, verbatim, and the date it was sent.> A new reading is an edit here, its pin in reader-policy.test.ts,
 *  and the rich-docs spec's E17 row. */
export const READER_E17_MERMAID: ReaderE17Reading = '<E17-READING>';

/** The Docs reader's draw for an E17 reading: on open, after `ready`, only when the line holds; otherwise on request, as
 *  W8a shipped it (the rich-docs spec's `reader-mermaid-on-tap`). */
export function docsDrawFor(e17: ReaderE17Reading): 'after-ready' | 'on-request' {
  return e17 === 'holds' ? 'after-ready' : 'on-request';
}

/** Whose bar a mount has (the take-up plan, refinement (g)): `frame-bar`, the reader frame's own; `host-bar`, ccrc's, with
 *  the frame's bar off, its top space trimmed and its progress reported. */
export type ReaderChrome = 'frame-bar' | 'host-bar';

/** A mount asks for ccrc's bar only at the compact width, read as the mount starts (refinement (f)). */
export function readerChromeFor(compactWidth: boolean): ReaderChrome {
  return compactWidth ? 'host-bar' : 'frame-bar';
}

/** How one mount draws, waits, stores, and whose bar it has. */
export interface ReaderMountPlan {
  readonly draw: 'auto' | 'on-request' | 'after-ready';
  readonly watchdogMs: number;
  /** Whether the mount is handed the reader's storage port. */
  readonly store: boolean;
  readonly chrome: ReaderChrome;
}

/** The one decision: the Docs reader draws as the E17 reading says (`docsDrawFor`), waits `readerWatchdogMs(bytes)`, keeps
 *  reader state and has the bar it asked for; the reader lab's `lab-draw` draws on open in the library's `auto` mode
 *  (where `ready` waits for the figures, so the lab's gap window still times the draw: refinement (d)), waits
 *  READER_LAB_DRAW_WATCHDOG_MS, keeps nothing and has the frame's own bar, whatever the reading and the bar asked for. */
export function readerMountPlan(
  profile: ReaderMountProfile | undefined, bytes: number, chrome: ReaderChrome, e17: ReaderE17Reading,
): ReaderMountPlan {
  return profile === 'lab-draw'
    ? { draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome: 'frame-bar' }
    : { draw: docsDrawFor(e17), watchdogMs: readerWatchdogMs(bytes), store: true, chrome };
}

/** The reader's tools a host may run without the frame's bar: the library's `DocFrame.command` names, held equal by
 *  reader-commands.test-d.ts (the quick jump, the reading settings, the contents drawer and a plan's Outline). */
export type ReaderCommand = 'jump' | 'settings' | 'contents' | 'outline';

const ONE_BAR_TOOLS: readonly ReaderCommand[] = ['jump', 'contents'];
const ONE_BAR_PLAN_TOOLS: readonly ReaderCommand[] = ['jump', 'contents', 'outline'];

/** The tools the one bar draws, in the frame's own bar's order (refinement (j)): the quick jump and the contents, and a
 *  plan's Outline on a plans leaf. The reading settings stay the frame's own button (question Q2). */
export function oneBarTools(section: DocSectionSlug): readonly ReaderCommand[] {
  return section === 'plans' ? ONE_BAR_PLAN_TOOLS : ONE_BAR_TOOLS;
}

/** The one bar's title (refinement (h)): the document's first level-1 heading as the library's render read it (the
 *  frame's own title), else the file name ccrc already shows. */
export function readerBarTitle(metaTitle: string | null, fileName: string): string {
  return metaTitle !== null && metaTitle.trim() !== '' ? metaTitle : fileName;
}
```
  And add one type import (Find: `import type { DocLinkContextValue } from '../DocLink';`; Replace: that line, then `import type { DocSectionSlug } from '../../../../shared/docs';`).
  The bridge's call (`bridge.ts`'s `readerMountPlan(input.profile, input.bytes)`) no longer compiles; Task 4 rewrites it. Until then, so that this task's commit typechecks, change that one call to `readerMountPlan(input.profile, input.bytes, 'frame-bar', 'does-not-hold')` (Find: `  const plan = readerMountPlan(input.profile, input.bytes);`), which keeps today's behaviour exactly; Task 4 replaces it.
- [ ] **Step 3: Green.** `reader-policy` its BASE count plus 7; `reader-commands.test-d.ts` 1 passed; `reader-bridge` and `reader-lab-bridge` at BASE (the lab case reads the new arguments); `TSC-OK`; `( cd pwa && ./node_modules/.bin/vitest run test/reader-lab-scans.test.ts )` green; `( cd server && ./node_modules/.bin/vitest run test/rings/pwa-rings.test.ts )` green; `git grep -n '<E17-READING>\|<Each block' -- pwa/src pwa/test` prints nothing (the recorded literal and the docstring's sentence are written in).
- [ ] **Step 4: Commit.** `git add pwa/src/docs/reader/policy.ts pwa/src/docs/reader/bridge.ts pwa/test/reader-policy.test.ts pwa/test/reader-commands.test-d.ts pwa/test/reader-bridge.test.ts` (expect 5), message `pwa: the reader's E17 reading, its bar, the one bar's tools and title, decided in one place (docs library 1.1 take-up)`, trailer.

**Mutation rows this task contributes** (pkg `pwa`, file `src/docs/reader/policy.ts` unless named):

| id | spec | old → new | tests | expected red (prediction) |
|---|---|---|---|---|
| L11-T3-M1 | (b) | `return e17 === 'holds' ? 'after-ready' : 'on-request';` → `return e17 === 'does-not-hold' ? 'on-request' : 'after-ready';` | `test/reader-policy.test.ts` | 2 failed — `'docsDrawFor draws after ready only when …'`, `'readerMountPlan: the Docs reader draws as the reading says …'` |
| L11-T3-M2 | (b) | `export const READER_E17_MERMAID: ReaderE17Reading = '<E17-READING>';` → the same with another of the three words | `test/reader-policy.test.ts` | 1 failed — `'READER_E17_MERMAID is the reading the operator\'s block gave'` |
| L11-T3-M3 | (d) | `? { draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome: 'frame-bar' }` → `? { draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome }` | `test/reader-policy.test.ts` | 1 failed — `'readerMountPlan: lab-draw draws on open …'` |
| L11-T3-M4 | (f) | `return compactWidth ? 'host-bar' : 'frame-bar';` → `return 'host-bar';` | `test/reader-policy.test.ts` | 1 failed — `'readerChromeFor: …'` |
| L11-T3-M5 | (j) | `const ONE_BAR_PLAN_TOOLS: readonly ReaderCommand[] = ['jump', 'contents', 'outline'];` → `const ONE_BAR_PLAN_TOOLS: readonly ReaderCommand[] = ['jump', 'contents'];` | `test/reader-policy.test.ts` | 1 failed — `'oneBarTools: …'` |
| L11-T3-M6 | (h) | `return metaTitle !== null && metaTitle.trim() !== '' ? metaTitle : fileName;` → `return metaTitle ?? fileName;` | `test/reader-policy.test.ts` | 1 failed — `'readerBarTitle: …'` |
| L11-T3-M7 | (j) | `export type ReaderCommand = 'jump' \| 'settings' \| 'contents' \| 'outline';` → `export type ReaderCommand = 'jump' \| 'settings' \| 'contents';` | `test/reader-commands.test-d.ts` | 1 failed (a type error) |

```json
[
  {"id": "L11-T3-M1", "spec": "(b)", "pkg": "pwa", "file": "src/docs/reader/policy.ts", "old": "return e17 === 'holds' ? 'after-ready' : 'on-request';", "new": "return e17 === 'does-not-hold' ? 'on-request' : 'after-ready';", "tests": ["test/reader-policy.test.ts"], "red": "2 failed: docsDrawFor draws after ready only when the E17 Mermaid line holds; readerMountPlan: the Docs reader draws as the reading says"},
  {"id": "L11-T3-M2", "spec": "(b)", "pkg": "pwa", "file": "src/docs/reader/policy.ts", "old": "export const READER_E17_MERMAID: ReaderE17Reading = '<E17-READING>';", "new": "export const READER_E17_MERMAID: ReaderE17Reading = '<another of the three words>';", "tests": ["test/reader-policy.test.ts"], "red": "1 failed: READER_E17_MERMAID is the reading the operator's block gave"},
  {"id": "L11-T3-M3", "spec": "(d)", "pkg": "pwa", "file": "src/docs/reader/policy.ts", "old": "? { draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome: 'frame-bar' }", "new": "? { draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome }", "tests": ["test/reader-policy.test.ts"], "red": "1 failed: readerMountPlan: lab-draw draws on open in the auto mode"},
  {"id": "L11-T3-M4", "spec": "(f)", "pkg": "pwa", "file": "src/docs/reader/policy.ts", "old": "return compactWidth ? 'host-bar' : 'frame-bar';", "new": "return 'host-bar';", "tests": ["test/reader-policy.test.ts"], "red": "1 failed: readerChromeFor"},
  {"id": "L11-T3-M5", "spec": "(j)", "pkg": "pwa", "file": "src/docs/reader/policy.ts", "old": "const ONE_BAR_PLAN_TOOLS: readonly ReaderCommand[] = ['jump', 'contents', 'outline'];", "new": "const ONE_BAR_PLAN_TOOLS: readonly ReaderCommand[] = ['jump', 'contents'];", "tests": ["test/reader-policy.test.ts"], "red": "1 failed: oneBarTools"},
  {"id": "L11-T3-M6", "spec": "(h)", "pkg": "pwa", "file": "src/docs/reader/policy.ts", "old": "return metaTitle !== null && metaTitle.trim() !== '' ? metaTitle : fileName;", "new": "return metaTitle ?? fileName;", "tests": ["test/reader-policy.test.ts"], "red": "1 failed: readerBarTitle"},
  {"id": "L11-T3-M7", "spec": "(j)", "pkg": "pwa", "file": "src/docs/reader/policy.ts", "old": "export type ReaderCommand = 'jump' | 'settings' | 'contents' | 'outline';", "new": "export type ReaderCommand = 'jump' | 'settings' | 'contents';", "tests": ["test/reader-commands.test-d.ts"], "red": "1 failed: ReaderCommand is the name type DocFrame.command takes"}
]
```
(L11-T3-M2's `old` and `new` are written with the recorded word and one of the other two when the row is recorded; the placeholders in angle brackets here are this plan's, never a file's.)

**Verify:** as Step 3.

### Task 4: The bridge: three Mermaid paths, ccrc's bar and the commands (refinements (c), (d), (e), (g), (i); L3)

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus` (the adapter set is the whole of ccrc's control over the frame).

**Files:**
- Modify: `pwa/src/docs/reader/bridge.ts`, `pwa/src/readerLab/run.ts` (one comment), `pwa/test/reader-bridge.test.ts`, `pwa/test/reader-lab-bridge.test.ts`.
- Create: `pwa/test/reader-lab-window.test.ts`.
- Guards (not edited): `pwa/test/docs-scans.test.ts`, `server/test/docs-parity.test.ts`, `pwa/test/reader-lab-run.test.ts`, `pwa/test/reader-lab-scans.test.ts`, `pwa/test/w7-storage-keys.test.ts`.

**Interfaces:** Consumes Task 3. Produces `ReaderMountInput.chrome?: ReaderChrome`, `ReaderMountInput.onProgress?: (share: number) => void`, `ReaderMountDeps.e17?: ReaderE17Reading` (tests only; production passes none, which is the recorded reading), `ReaderMount.command?(name: ReaderCommand): void`.

- [ ] **Step 0: The interim line.** `git grep -c "readerMountPlan(input.profile, input.bytes, 'frame-bar', 'does-not-hold')" -- pwa/src/docs/reader/bridge.ts` prints `1` (Task 3's line, which Step 2 replaces). Confirm the claims.
- [ ] **Step 1: Tests, red first** (`pwa/test/reader-bridge.test.ts`):
  - The rig gains `e17?: ReaderE17Reading` (default `'does-not-hold'`, so every W8a case keeps its meaning: on request), `chrome?: ReaderChrome`, `onProgress?: (share: number) => void` and `onMermaidDrop?: () => void` in its options, passes `e17` in the deps and `chrome`/`onProgress`/`onMermaidDrop` in the input when given, and its fake frame gains `command: vi.fn()`.
  - In the lab-profile describe, `adaptersFor` passes `e17: 'does-not-hold'` in its deps (Find: `      assets: () => Promise.resolve(STUB_ASSETS), mermaid: () => Promise.resolve('MERMAID'),`; Replace: that line, then `      e17: 'does-not-hold',`), so its `'no profile is the Docs reader …'` case keeps asserting `on-request` in both arms (without it, arm A's recorded `holds` plans `after-ready` there); that case is renamed `'no profile is the Docs reader: Mermaid on request where E17 did not hold, the reader watchdog, the storage port'`. The `lab-draw` case is unchanged by it (the lab draws `auto` whatever the reading).
  - In the Mermaid gate describe, add `'on request, a rejected load drops the scan and reports no drop: the drop report is the lab\'s alone'`: the rig at its default `e17` (`'does-not-hold'`), a gated scan (`mermaidCounts(2, 100, 200)`), a loader that rejects and `onMermaidDrop: vi.fn()` → `mount` called once, `document.scan` undefined, the drop never called. With reader-lab-bridge's ordinary arm, it is what reds when the drop is reported for every draw (L11-T4-M7).
  - Replace the case `'the adapters are exactly ccrc\'s fourteen keys, with no changes or openVersion'` with `'the adapters are ccrc\'s keys for each draw and bar: the fourteen, loadMermaid after ready, features and onProgress on ccrc\'s bar'`, four literal sorted lists, each rig with a store and a doc key: `('does-not-hold', 'frame-bar')` the fourteen of W8a; `('holds', 'frame-bar')` those plus `loadMermaid` (15); `('does-not-hold', 'host-bar')` the fourteen plus `features` and `onProgress` (16); `('holds', 'host-bar')` all three (17: `assets`, `copy`, `docKey`, `features`, `focus`, `loadMermaid`, `mermaidDraw`, `onFallback`, `onHash`, `onLink`, `onProgress`, `onReady`, `prefs`, `store`, `storePrefix`, `title`, `watchdogMs`). In each, `changes`, `openVersion` and `mermaidGate` are absent.
  - Rename `'mermaidDraw is on-request, storePrefix is ccrc:reader:v1:, focus is true'`'s first assertion's arm explicit (`e17: 'does-not-hold'`), and add `'mermaidDraw is after-ready when E17 held'`.
  - New describe `'Mermaid drawn after ready (the take-up plan, refinement (c))'`, each with `e17: 'holds'` and a gated scan (`mermaidCounts(2, 100, 200)`):
    1. `'hands the library the loader itself and awaits nothing before the mount'`: the injected loader is never called by the bridge; `mount` called once; `adapters.loadMermaid` is the injected loader (`toBe`); `adapters.assets.mermaid` undefined; `document.scan` equals the scan.
    2. `'a loader that never settles does not hold the mount, and leaves no timer'`: fake timers; after `advanceTimersByTimeAsync(0)` the mount was called; `vi.getTimerCount()` 0.
    3. `'a doc over the gate is handed the loader too: the library\'s gate decides'`: scan of 25 fences; `adapters.loadMermaid` present; the scan kept; the loader not called.
    4. `'the D-8030 drop is never reported for the Docs reader'`: input with `onMermaidDrop: vi.fn()` and a loader that rejects; the drop not called.
  - New describe `'ccrc\'s bar and the commands (the take-up plan, refinements (g), (i))'`:
    1. `'a host-bar mount turns the frame\'s bar off and trims its top space, as a fresh plain object'`: `adapters.features` `toEqual({ chrome: { bar: false, topSpace: false } })`, its prototype `Object.prototype`, and two mounts get two distinct objects.
    2. `'a host-bar mount forwards each progress share to the input'`: `adapters.onProgress!(0.25)` → `input.onProgress` called with `0.25`; without `input.onProgress`, `adapters.onProgress!(1)` does not throw.
    3. `'a frame-bar mount, and a mount that names no chrome, pass neither features nor onProgress'`.
    4. `'command forwards to DocFrame.command at once, and does nothing after destroy'`: `m.command!('jump')` → `frame.command` called once with `'jump'` before any await; `m.destroy(); m.command!('contents')` → still once.
    5. `'a mount whose assets did not load has no command'`: the asset-rejecting rig's mount has no `command` member.
    6. `'with no e17 dep, the recorded reading decides the draw'`: a rig with `e17` omitted from the deps (pass `deps` without it) → `adapters.mermaidDraw === docsDrawFor(READER_E17_MERMAID)`.
  - In the real-mount describe, add `'the installed library seeds a host-bar mount drawn after ready with the bar off, progress asked for, and no Mermaid script in its srcdoc'`: `mountReader` with the real library and assets, `chrome: 'host-bar'`, `onProgress: vi.fn()`, deps `{ store: () => fakeStore(), e17: 'holds', mermaid: () => Promise.resolve('x') }`, a document with a one-fence scan; `console.warn` spied (the library warns once that `'x'` is not the shipped build). Parse the iframe's `srcdoc`: the `script[type="application/json"]` seed's `features.chrome` is `{ bar: false, topSpace: false }`, `bridge.progress` is `true`, `mermaid.draw` is `'after-ready'`; no `script` text's sha256 is `FRAME_MANIFEST.mermaid.sha256`, and the srcdoc is shorter than `FRAME_MANIFEST.mermaid.chars`.
  - `pwa/test/reader-lab-bridge.test.ts`: the rig takes `e17` (default `'does-not-hold'`, passed in the deps), so the existing case's ordinary arm (no profile, a rejecting loader) still plans on request, runs the pre-mount load, reaches the drop branch and must not report: it stays D-8030's red guard (L11-T4-M7) in both arms. One case is added, passing `'holds'` explicitly: `'with E17 held the lab still inlines (auto), loads first and reports a drop; it is handed no loader and no bar'`: the rejected-load rig with `'lab-draw'` and `e17: 'holds'` → `dropped` called once; the mount's adapters have `mermaidDraw: 'auto'` and none of `loadMermaid`, `features`, `onProgress`.
  - Create `pwa/test/reader-lab-window.test.ts`:
```ts
// The reader lab's gap window and its draw mode, held together (the take-up plan, refinement (d)): `lab-draw` draws in the
// library's `auto` mode, where `ready` waits for every figure, so the window that ends at `ready` times the whole draw.
import { describe, expect, it } from 'vitest';
import { readerMountPlan } from '../src/docs/reader/policy';
import { LAB_GAP_WINDOW } from '../src/readerLab/run';

describe('the reader lab\'s window matches its draw', () => {
  it('lab-draw draws in auto mode whatever the reading, and the window ends at ready', () => {
    for (const e17 of ['holds', 'does-not-hold', 'not-measured'] as const) {
      expect(readerMountPlan('lab-draw', 0, 'host-bar', e17).draw).toBe('auto');
    }
    expect(LAB_GAP_WINDOW).toBe('ready');
  });
});
```
  Run them — Expected (prediction): the census, the after-ready, the bar and the command cases fail (no such adapters or member), the window case passes (it pins today's state).
- [ ] **Step 2: The bridge.** In `pwa/src/docs/reader/bridge.ts`:
  Find (origin/main `ce55b1ca9`):
```ts
// rich-docs spec's (amended 2026-10-31) M8.1, M8.15, M8.20 and section 4.4, the W8a plan's refinements (b), (c) and (k)). Ring L3: it is
// the one file that imports the library's host entry. What it hands the library is the whole of ccrc's control over
// the frame, so the adapter set is exactly fourteen keys: `assets`, `watchdogMs`, `store`, `storePrefix`, `docKey`,
// `prefs`, `mermaidDraw`, `title`, `focus` and the five callbacks. It never passes `changes`, `openVersion`,
// `features` or `mermaidGate`, so the frame offers no change marks, version list or feature switch, and the Mermaid
// gate runs at the library's own caps.
```
  Replace:
```ts
// rich-docs spec's (amended 2026-10-31) M8.1, M8.15, M8.20 and section 4.4, the W8a plan's refinements (b), (c) and (k)). Ring L3: it is
// the one file that imports the library's host entry. What it hands the library is the whole of ccrc's control over
// the frame: W8a's fourteen keys (`assets`, `watchdogMs`, `store`, `storePrefix`, `docKey`, `prefs`, `mermaidDraw`,
// `title`, `focus` and the five callbacks), and since the library 1.1 take-up `loadMermaid` for a mount drawn after
// `ready`, and `features` (the frame's bar off, its top space trimmed) with `onProgress` for a mount on ccrc's bar (the
// take-up plan, refinements (c) and (g)). It never passes `changes`, `openVersion` or `mermaidGate`, so the frame offers
// no change marks or version list, and the Mermaid gate runs at the library's own caps.
```
  Find:
```ts
// does three things of its own. It unwraps the library's callback shapes into ccrc's (the copy check's `hidden`
// list, the host link's fields). It keeps the version to what a full commit names (the W8a plan's refinement (k)). And it loads the
// Mermaid text only for a document the library's gate lets in; a Mermaid chunk that does not load drops the scan,
// so the figures show their source and the page still mounts (the W8a plan's refinement (c)).
```
  Replace:
```ts
// does three things of its own. It unwraps the library's callback shapes into ccrc's (the copy check's `hidden`
// list, the host link's fields). It keeps the version to what a full commit names (the W8a plan's refinement (k)). And
// it gets the Mermaid text to the library by the draw's own path (the take-up plan, refinement (c)): drawn after
// `ready`, it hands the library the loader and awaits nothing, and the library asks only for a document its gate lets
// in; drawn on request or on open, it loads the text first, only for such a document, and a chunk that does not load
// drops the scan, so the figures show their source and the page still mounts (the W8a plan's refinement (c)).
```
  Find:
```ts
// `mountReader` never remounts: the library's `update` is not called, and a theme change is the library's `setPrefs`.
// The watchdog, the draw mode and whether a storage port is handed over are `policy.ts#readerMountPlan`'s, by the input's
// `profile`: none for the Docs reader, `lab-draw` for the reader lab's timed mounts (the reader lab plan, refinement (k)).
```
  Replace:
```ts
// `mountReader` never remounts: the library's `update` is not called, and a theme change is the library's `setPrefs`.
// The watchdog, the draw mode, whether a storage port is handed over and whose bar the frame has are
// `policy.ts#readerMountPlan`'s, by the input's `profile` (none for the Docs reader, `lab-draw` for the reader lab's
// timed mounts: the reader lab plan, refinement (k)), its `chrome`, and the recorded E17 reading.
```
  Find: `import { readerMountPlan, type ReaderLink, type ReaderMountProfile } from './policy';`
  Replace:
```ts
import {
  READER_E17_MERMAID, readerMountPlan,
  type ReaderChrome, type ReaderCommand, type ReaderE17Reading, type ReaderLink, type ReaderMountProfile,
} from './policy';
```
  Find:
```ts
  readonly profile?: ReaderMountProfile;
}

export interface ReaderMountDeps {
  readonly mount?: typeof mountDocFrame;
  readonly store?: () => EnumerableStoragePort | null;
  readonly assets?: () => Promise<FrameAssets>;
  readonly mermaid?: () => Promise<string>;
}

export interface ReaderMount {
  /** Idempotent. */
  destroy(): void;
  /** The frame's `prefs` operation: applied in place, with no remount. */
  setPrefs(p: ReaderThemePref): void;
}
```
  Replace:
```ts
  readonly profile?: ReaderMountProfile;
  /** Whose bar the frame has; absent, the frame's own. `host-bar` turns the frame's bar off (the take-up plan,
   *  refinement (g)). The lab passes none. */
  readonly chrome?: ReaderChrome;
  /** How far the document has been read, 0 to 1, for a mount on ccrc's bar; absent, nobody listens. */
  readonly onProgress?: (share: number) => void;
}

export interface ReaderMountDeps {
  readonly mount?: typeof mountDocFrame;
  readonly store?: () => EnumerableStoragePort | null;
  readonly assets?: () => Promise<FrameAssets>;
  readonly mermaid?: () => Promise<string>;
  /** Tests only: the E17 reading to plan with; absent, the recorded one (`READER_E17_MERMAID`). */
  readonly e17?: ReaderE17Reading;
}

export interface ReaderMount {
  /** Idempotent. */
  destroy(): void;
  /** The frame's `prefs` operation: applied in place, with no remount. */
  setPrefs(p: ReaderThemePref): void;
  /** Runs one of the reader's tools, as a toggle, through the library's `DocFrame.command` (which focuses the frame first
   *  and does nothing before `ready`). Call it from a tap's own handler. Absent: this mount has no frame to command (the
   *  assets did not load). */
  command?(name: ReaderCommand): void;
}
```
  Find (as Task 3 leaves it; the find-check skips this block, and Task 4's Step 0 greps it once):
```ts
  const plan = readerMountPlan(input.profile, input.bytes, 'frame-bar', 'does-not-hold');
  const watchdogMs = plan.watchdogMs;
  let document = withServedVersion(input.document);
  if (document.scan !== undefined && mermaidGate(document.scan.mermaid).inline) {
```
  Replace:
```ts
  const plan = readerMountPlan(input.profile, input.bytes, input.chrome ?? 'frame-bar', deps.e17 ?? READER_E17_MERMAID);
  const watchdogMs = plan.watchdogMs;
  const loadMermaid = deps.mermaid ?? loadMermaidAsset;
  let document = withServedVersion(input.document);
  // Drawn after `ready`, the library asks for the text itself (`loadMermaid`, below): nothing waits here. Drawn on request
  // or on open the text is inlined, so it is loaded first.
  if (plan.draw !== 'after-ready' && document.scan !== undefined && mermaidGate(document.scan.mermaid).inline) {
```
  Find: `      assets = { ...assets, mermaid: await Promise.race([(deps.mermaid ?? loadMermaidAsset)(), deadline]) };`
  Replace: `      assets = { ...assets, mermaid: await Promise.race([loadMermaid(), deadline]) };`
  Find:
```ts
    mermaidDraw: plan.draw,
    title: input.title,
```
  Replace:
```ts
    mermaidDraw: plan.draw,
    ...(plan.draw === 'after-ready' ? { loadMermaid } : {}),
    ...(plan.chrome === 'host-bar'
      ? { features: { chrome: { bar: false, topSpace: false } }, onProgress: (share: number) => input.onProgress?.(share) }
      : {}),
    title: input.title,
```
  Find:
```ts
    setPrefs(p) {
      if (destroyed) return;
      frame.setPrefs({ theme: p.theme });
    },
  };
}
```
  Replace:
```ts
    setPrefs(p) {
      if (destroyed) return;
      frame.setPrefs({ theme: p.theme });
    },
    command(name) {
      if (destroyed) return;
      frame.command(name);
    },
  };
}
```
  (The `INERT` mount keeps its two members and gains none.)
- [ ] **Step 3: The lab's comment** (`pwa/src/readerLab/run.ts`). Find:
```ts
/** The window for the library this build pins. The library change that draws after `ready` flips it, in that change. */
export const LAB_GAP_WINDOW: LabGapWindow = 'ready';
```
  Replace:
```ts
/** The window for the lab's own draw. `lab-draw` draws in the library's `auto` mode, where `ready` waits for every figure
 *  (1.0.0, and 1.1.0, which added `after-ready` as a mode of its own and left `auto` as it was), so the window ends at
 *  `ready` and times the whole draw (the library 1.1 take-up plan, refinement (d); reader-lab-window.test.ts holds the
 *  two together). `ready-and-settle` is for a lab profile that draws after `ready`, which none does. */
export const LAB_GAP_WINDOW: LabGapWindow = 'ready';
```
- [ ] **Step 4: Green.** `reader-bridge` its BASE count plus 13 (prediction: one census case replaced, thirteen added, in either arm: the rig and `adaptersFor` both plan with `'does-not-hold'` unless a case names `'holds'`); `reader-lab-bridge` 3 passed; `reader-lab-window` 1 passed; `docs-scans`, `reader-lab-run`, `reader-lab-scans`, `w7-storage-keys` at BASE; `TSC-OK`; `( cd server && ./node_modules/.bin/vitest run test/docs-parity.test.ts )` at BASE.
- [ ] **Step 5: Commit.** `git add pwa/src/docs/reader/bridge.ts pwa/src/readerLab/run.ts pwa/test/reader-bridge.test.ts pwa/test/reader-lab-bridge.test.ts pwa/test/reader-lab-window.test.ts` (expect 5), message `pwa: the bridge draws Mermaid by the draw's own path, mounts on ccrc's bar, and passes commands (docs library 1.1 take-up)`, trailer.

**Mutation rows this task contributes** (pkg `pwa`, file `src/docs/reader/bridge.ts` unless named):

| id | spec | old → new | tests | expected red (prediction) |
|---|---|---|---|---|
| L11-T4-M1 | (c) | `...(plan.draw === 'after-ready' ? { loadMermaid } : {}),` → *(deleted)* | `test/reader-bridge.test.ts` | 3+ failed — the census (both after-ready lists), `'hands the library the loader itself …'`, `'a doc over the gate is handed the loader too …'` |
| L11-T4-M2 | (c) | `if (plan.draw !== 'after-ready' && document.scan !== undefined && mermaidGate(document.scan.mermaid).inline) {` → `if (document.scan !== undefined && mermaidGate(document.scan.mermaid).inline) {` | `test/reader-bridge.test.ts` | 2+ failed — `'hands the library the loader itself and awaits nothing …'`, `'a loader that never settles …'` |
| L11-T4-M3 | (g) | `? { features: { chrome: { bar: false, topSpace: false } }, onProgress: (share: number) => input.onProgress?.(share) }` → `? { features: { chrome: { bar: true, topSpace: false } }, onProgress: (share: number) => input.onProgress?.(share) }` | `test/reader-bridge.test.ts` | 2 failed — `'a host-bar mount turns the frame\'s bar off …'`, the real-mount seed case |
| L11-T4-M4 | (g) | `features: { chrome: { bar: false, topSpace: false } }` → `features: { chrome: { bar: false } }` | `test/reader-bridge.test.ts` | 2 failed — the same two |
| L11-T4-M5 | (g) | `onProgress: (share: number) => input.onProgress?.(share)` → `onProgress: () => undefined` | `test/reader-bridge.test.ts` | 1 failed — `'a host-bar mount forwards each progress share …'` |
| L11-T4-M6 | (i) | in `command(name) {`, `if (destroyed) return;` → *(deleted)* | `test/reader-bridge.test.ts` | 1 failed — `'command forwards to DocFrame.command at once, and does nothing after destroy'` |
| L11-T4-M7 | (c), (d) D-8030 | `if (plan.draw === 'auto') input.onMermaidDrop?.();` → `input.onMermaidDrop?.();` | `test/reader-lab-bridge.test.ts`, `test/reader-bridge.test.ts` | 2 failed — reader-lab-bridge's `'signals a rejected load only for the lab profile …'` (its ordinary arm, on request at the rig's default `'does-not-hold'`), reader-bridge's `'on request, a rejected load drops the scan and reports no drop …'` |
| L11-T4-M8 | (b) | `deps.e17 ?? READER_E17_MERMAID` → `deps.e17 ?? '<a word other than E17-READING>'` (the opposite arm) | `test/reader-bridge.test.ts` | 1 failed — `'with no e17 dep, the recorded reading decides the draw'` |
| L11-T4-M9 | (d) | `src/readerLab/run.ts`: `export const LAB_GAP_WINDOW: LabGapWindow = 'ready';` → `export const LAB_GAP_WINDOW: LabGapWindow = 'ready-and-settle';` | `test/reader-lab-window.test.ts` | 1 failed |
| L11-T4-M10 | (g) | `...(plan.chrome === 'host-bar'` → `...(true` (every mount, the lab's and every desktop's included, gets the bar off) | `test/reader-bridge.test.ts`, `test/reader-lab-bridge.test.ts` | 3+ failed — the census (both frame-bar lists), `'a frame-bar mount, and a mount that names no chrome, pass neither features nor onProgress'`, reader-lab-bridge's `'with E17 held the lab still inlines …'` |

```json
[
  {"id": "L11-T4-M1", "spec": "(c)", "pkg": "pwa", "file": "src/docs/reader/bridge.ts", "old": "...(plan.draw === 'after-ready' ? { loadMermaid } : {}),", "new": "", "tests": ["test/reader-bridge.test.ts"], "red": "3+ failed: the census; hands the library the loader itself; a doc over the gate is handed the loader too"},
  {"id": "L11-T4-M2", "spec": "(c)", "pkg": "pwa", "file": "src/docs/reader/bridge.ts", "old": "if (plan.draw !== 'after-ready' && document.scan !== undefined && mermaidGate(document.scan.mermaid).inline) {", "new": "if (document.scan !== undefined && mermaidGate(document.scan.mermaid).inline) {", "tests": ["test/reader-bridge.test.ts"], "red": "2+ failed: hands the library the loader itself and awaits nothing; a loader that never settles"},
  {"id": "L11-T4-M3", "spec": "(g)", "pkg": "pwa", "file": "src/docs/reader/bridge.ts", "old": "? { features: { chrome: { bar: false, topSpace: false } }, onProgress: (share: number) => input.onProgress?.(share) }", "new": "? { features: { chrome: { bar: true, topSpace: false } }, onProgress: (share: number) => input.onProgress?.(share) }", "tests": ["test/reader-bridge.test.ts"], "red": "2 failed: a host-bar mount turns the frame's bar off; the real-mount seed case"},
  {"id": "L11-T4-M4", "spec": "(g)", "pkg": "pwa", "file": "src/docs/reader/bridge.ts", "old": "features: { chrome: { bar: false, topSpace: false } }", "new": "features: { chrome: { bar: false } }", "tests": ["test/reader-bridge.test.ts"], "red": "2 failed: a host-bar mount turns the frame's bar off; the real-mount seed case"},
  {"id": "L11-T4-M5", "spec": "(g)", "pkg": "pwa", "file": "src/docs/reader/bridge.ts", "old": "onProgress: (share: number) => input.onProgress?.(share)", "new": "onProgress: () => undefined", "tests": ["test/reader-bridge.test.ts"], "red": "1 failed: a host-bar mount forwards each progress share"},
  {"id": "L11-T4-M6", "spec": "(i)", "pkg": "pwa", "file": "src/docs/reader/bridge.ts", "old": "if (destroyed) return;\n      frame.command(name);", "new": "frame.command(name);", "tests": ["test/reader-bridge.test.ts"], "red": "1 failed: command forwards to DocFrame.command at once, and does nothing after destroy"},
  {"id": "L11-T4-M7", "spec": "(c) (d) D-8030", "pkg": "pwa", "file": "src/docs/reader/bridge.ts", "old": "if (plan.draw === 'auto') input.onMermaidDrop?.();", "new": "input.onMermaidDrop?.();", "tests": ["test/reader-lab-bridge.test.ts", "test/reader-bridge.test.ts"], "red": "2 failed: signals a rejected load only for the lab profile (its ordinary arm); on request, a rejected load drops the scan and reports no drop"},
  {"id": "L11-T4-M8", "spec": "(b)", "pkg": "pwa", "file": "src/docs/reader/bridge.ts", "old": "deps.e17 ?? READER_E17_MERMAID", "new": "deps.e17 ?? '<a word other than E17-READING>'", "tests": ["test/reader-bridge.test.ts"], "red": "1 failed: with no e17 dep, the recorded reading decides the draw"},
  {"id": "L11-T4-M9", "spec": "(d)", "pkg": "pwa", "file": "src/readerLab/run.ts", "old": "export const LAB_GAP_WINDOW: LabGapWindow = 'ready';", "new": "export const LAB_GAP_WINDOW: LabGapWindow = 'ready-and-settle';", "tests": ["test/reader-lab-window.test.ts"], "red": "1 failed: lab-draw draws in auto mode whatever the reading, and the window ends at ready"},
  {"id": "L11-T4-M10", "spec": "(g)", "pkg": "pwa", "file": "src/docs/reader/bridge.ts", "old": "...(plan.chrome === 'host-bar'", "new": "...(true", "tests": ["test/reader-bridge.test.ts", "test/reader-lab-bridge.test.ts"], "red": "3+ failed: the census; a frame-bar mount, and a mount that names no chrome, pass neither features nor onProgress; with E17 held the lab still inlines"}
]
```
(L11-T4-M8's `new` is written with the actual word when recorded; the angle brackets are this plan's.)

**Verify:** as Step 4.

### Task 5: The reader's bar, asked for at the mount and published at ready (refinements (f), (h), (i); L4)

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus` (the lifetime: what is published when, and what is withdrawn).

**Files:**
- Create: `pwa/src/docs/readerBar.ts`.
- Modify: `pwa/src/docs/ReaderFrame.tsx`, `pwa/src/screens/DocsScreen.tsx`, `pwa/test/reader-frame.test.tsx` (the harness's handle gains `command`, one appended describe).
- Guards (not edited): `pwa/test/docs-scans.test.ts`, `pwa/test/docs-screen.test.tsx`, `pwa/test/docs-compact-head.test.tsx`, `pwa/test/reader-lab-run.test.ts`, `pwa/test/app-lazy.test.tsx`, the server's `rings/*` and `census-w7/*`.

**Interfaces:** Consumes Tasks 3 and 4. Produces `ReaderProgress` (`read()`, `subscribe(listener)`), `ReaderBar` (`title`, `command(name)`, `progress`), `ReaderBarSlot` (`chrome`, `publish(bar)`), `ReaderBarContext`, `createReaderProgress()` (a `ReaderProgress` with `set(share)`), `usePublishReaderBar(bar)`; `DocsHead`'s new prop `readerBar` is Task 6's.

- [ ] **Step 1: `pwa/src/docs/readerBar.ts`.**
```ts
// The reader's bar, published for the Docs header (the library 1.1 take-up plan, refinements (f), (i)): what the one bar
// needs of a ready frame that was mounted with ccrc's bar: the document's title, the frame's commands and how far it has
// been read. `DocsScreen` provides the slot: which bar a mount asks for (decided by the screen's width, through
// `policy.ts#readerChromeFor`) and where the bar is published. `ReaderFrame` reads the bar when its mount starts,
// publishes the handle while that frame is ready, and withdraws it (`null`) when the frame falls back or goes; the screen
// hands it to `DocsHead`, as it hands Export's body. The reader lab mounts without `ReaderFrame`, so it never sees the
// slot. Progress is a small store, read by the head's reading line alone, so a report re-renders one element.
// Ring L4: a context, a hook and a store; it decides nothing.
import { createContext, useContext, useEffect } from 'react';
import type { ReaderChrome, ReaderCommand } from './reader/policy';

/** How far the document has been read, 0 to 1: the frame's latest report. */
export interface ReaderProgress {
  read(): number;
  subscribe(listener: () => void): () => void;
}

/** A ready frame on ccrc's bar, as the head drives it. */
export interface ReaderBar {
  readonly title: string;
  /** Runs one of the reader's tools as a toggle; call it from the tap's own handler. */
  command(name: ReaderCommand): void;
  readonly progress: ReaderProgress;
}

/** Which bar a mount asks for, and where its handle is published. `null` context: no Docs screen above (the frame's own bar). */
export interface ReaderBarSlot {
  readonly chrome: ReaderChrome;
  publish(bar: ReaderBar | null): void;
}

export const ReaderBarContext = createContext<ReaderBarSlot | null>(null);

/** A progress store starting at 0; `set` stores a share and tells every listener. */
export function createReaderProgress(): ReaderProgress & { set(share: number): void } {
  let share = 0;
  const listeners = new Set<() => void>();
  return {
    read: () => share,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(next) {
      share = next;
      for (const l of listeners) l();
    },
  };
}

/** Publishes `bar` while it stands and the component is mounted, and withdraws it after. The caller keeps `bar` stable. */
export function usePublishReaderBar(bar: ReaderBar): void {
  const slot = useContext(ReaderBarContext);
  useEffect(() => {
    if (slot === null) return undefined;
    slot.publish(bar);
    return () => slot.publish(null);
  }, [slot, bar]);
}
```
- [ ] **Step 2: Tests, red first** (`pwa/test/reader-frame.test.tsx`). The harness's `handle` gains `command: vi.fn()` (its type too). A helper `slotted(h, chrome, publish)` renders `frame(h)` inside `<ReaderBarContext value={{ chrome, publish }}>`. Append a describe `'ccrc\'s bar (the take-up plan, Task 5)'`:
  1. `'a host-bar slot mounts with ccrc\'s bar and asks for progress'`: the input's `chrome` is `'host-bar'` and its `onProgress` a function.
  2. `'a frame-bar slot, and no slot, mount with the frame\'s own bar and ask for no progress; nothing is published'`: `chrome` `'frame-bar'`, no `onProgress`; after `act(() => input.onReady())`, `publish` never called with a non-null value.
  3. `'the bar is published at ready, not before'`: host-bar; after the mount resolves, `publish` not yet called with a bar; `act(() => input.onReady())` → its last call has a bar.
  4. `'the bar\'s title is the document\'s own, else the file name'`: an outcome whose `meta.title` is `'Doc title'` → `bar.title === 'Doc title'`; `RENDERED` (title `null`) → `leafName(show.path)`.
  5. `'the bar\'s command reaches the mount\'s command'`: `bar.command('contents')` → `handle.command` called with `'contents'`.
  6. `'progress reaches the bar\'s store and its listeners'`: `bar.progress.subscribe(spy)`; `act(() => input.onProgress!(0.4))` → `read() === 0.4`, `spy` called.
  7. `'a fallback after ready withdraws the bar, and so does an unmount'`: `act(() => input.onFallback('error'))` → the last `publish` call is `null`; a second render, unmounted after ready → the last call `null`.
  8. `'the slot\'s bar is read as the mount starts: a later change does not remount'`: rerender with the slot's `chrome` flipped → `mountFn` called once.
  9. `'the Docs screen asks for ccrc\'s bar under the compact width and for the frame\'s own above it'`: `DocsScreen` (the `Routed` form of `docs-compact-head.test.tsx`, with `fakeLoaders` answering a Markdown leaf) and this harness's reader, at `atWidth(412)` (that file's helper's form, written locally) → the input's `chrome` is `'host-bar'`; at `atWidth(1280)` → `'frame-bar'`.
  Run — Expected: the module `readerBar` does not exist; then each case fails.
- [ ] **Step 3: `ReaderFrame.tsx`.** Find (origin/main `ce55b1ca9`):
  `//   G7  a Mermaid chunk that does not load is `mountReader`'s own (it drops the scan and still mounts).`
  Replace:
```ts
//   G7  a Mermaid chunk that does not load is `mountReader`'s own on request (it drops the scan and still mounts), and
//       the library's own after `ready` (every figure stays its source, with the load note).
// On the Docs screen the mount asks for the bar the screen's slot names (`docs/readerBar.ts`), as it starts; on ccrc's
// bar the handle (the title, the commands, the progress) is published while the frame is ready (the library 1.1
// take-up plan, refinement (i)).
```
  Find:
```ts
import { READER_FALLBACK_NOTE, type ReaderHiddenChar } from './reader/readerText';
```
  Replace:
```ts
import { READER_FALLBACK_NOTE, type ReaderHiddenChar } from './reader/readerText';
import { ReaderBarContext, createReaderProgress, usePublishReaderBar, type ReaderBar } from './readerBar';
```
  Find:
```ts
  copyDecision, readerBodyReducer, readerDocKey, readerPrefsOf, routeReaderLink, type ReaderBodyState, type ReaderLink,
} from './reader/policy';
```
  Replace:
```ts
  copyDecision, readerBarTitle, readerBodyReducer, readerDocKey, readerPrefsOf, routeReaderLink,
  type ReaderBodyState, type ReaderLink,
} from './reader/policy';
```
  Find:
```ts
function ReaderShown(): null {
  usePublishExportBody(READER_BODY);
  return null;
}
```
  Replace:
```ts
function ReaderShown(): null {
  usePublishExportBody(READER_BODY);
  return null;
}

/** Publishes the frame's bar for the Docs header while the frame is ready (the take-up plan, refinement (i)). Mounted in
 *  the ready arm only, so a fallback or an unmount withdraws it. */
function ReaderBarShown(p: { readonly bar: ReaderBar }): null {
  usePublishReaderBar(p.bar);
  return null;
}
```
  Find:
```ts
  const [ask, setAsk] = useState<Ask | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
```
  Replace:
```ts
  const [ask, setAsk] = useState<Ask | null>(null);
  /** The bar this body's frame publishes once ready; `null`: its frame is on its own bar, or not mounted yet. */
  const [bar, setBar] = useState<ReaderBar | null>(null);
  const barSlot = useContext(ReaderBarContext);
  const hostRef = useRef<HTMLDivElement | null>(null);
```
  Find:
```ts
  const live = useRef({ props: p, link, assets, prefs });
  useEffect(() => {
    live.current = { props: p, link, assets, prefs };
  });
```
  Replace:
```ts
  const live = useRef({ props: p, link, assets, prefs, barSlot });
  useEffect(() => {
    live.current = { props: p, link, assets, prefs, barSlot };
  });
```
  Find:
```ts
      dispatch({ e: 'mount' });
      seededPrefs.current = cur.prefs;
      const input: ReaderMountInput = {
```
  Replace:
```ts
      dispatch({ e: 'mount' });
      seededPrefs.current = cur.prefs;
      // The bar is read once, here: the frame keeps it for its life (refinement (f)).
      const chrome = cur.barSlot?.chrome ?? 'frame-bar';
      const progress = chrome === 'host-bar' ? createReaderProgress() : null;
      const input: ReaderMountInput = {
```
  Find:
```ts
        onFallback: (r) => fallBack(String(r)),
      };
      performance.mark('ccrc-reader-mount-start');
```
  Replace:
```ts
        onFallback: (r) => fallBack(String(r)),
        chrome,
        ...(progress === null ? {} : { onProgress: (share: number) => progress.set(share) }),
      };
      performance.mark('ccrc-reader-mount-start');
```
  Find:
```ts
      mount = m;
      mountRef.current = m;
```
  Replace:
```ts
      mount = m;
      mountRef.current = m;
      if (progress !== null) {
        setBar({
          title: readerBarTitle(outcome.result.meta.title, leafName(cur.props.show.path)),
          command: (name) => m.command?.(name),
          progress,
        });
      }
```
  Find:
```ts
          <div className="docs-reader" ref={hostRef} />
          {sheets}
          <ReaderShown />
```
  Replace:
```ts
          <div className="docs-reader" ref={hostRef} />
          {sheets}
          <ReaderShown />
          {state.s === 'ready' && bar !== null && <ReaderBarShown bar={bar} />}
```
- [ ] **Step 4: `DocsScreen.tsx`.** Find: `import { DocsHead, soonUntil, type FreshChipState } from '../docs/DocsHead';` — Replace: `import { DOCS_COMPACT_QUERY, DocsHead, soonUntil, type FreshChipState } from '../docs/DocsHead';`
  Find: `import { ExportBodyContext, type ExportBody } from '../docs/exportBody';` — Replace:
```ts
import { ExportBodyContext, type ExportBody } from '../docs/exportBody';
import { ReaderBarContext, type ReaderBar, type ReaderBarSlot } from '../docs/readerBar';
import { readerChromeFor } from '../docs/reader/policy';
```
  Find: `import { navigate } from '../lib/router';` — Replace:
```ts
import { navigate } from '../lib/router';
import { useMediaQuery } from '../lib/useMediaQuery';
```
  Find:
```ts
  const [plainAt, setPlainAt] = useState<string | null>(null);
```
  Replace:
```ts
  const [plainAt, setPlainAt] = useState<string | null>(null);
  // The one bar (the library 1.1 take-up plan, refinement (i)): a frame mounted at the compact width is on ccrc's bar,
  // and once it is ready its handle comes back here for the head. A width change moves the next mount, never this one.
  const [readerBar, setReaderBar] = useState<ReaderBar | null>(null);
  const compactWidth = useMediaQuery(DOCS_COMPACT_QUERY);
  const barSlot = useMemo<ReaderBarSlot>(() => ({ chrome: readerChromeFor(compactWidth), publish: setReaderBar }), [compactWidth]);
```
  Find:
```ts
            exportAssets={exportAssets} plainView={plainAt === here} onPlainView={() => setPlainAt(here)}
          />
```
  Replace:
```ts
            exportAssets={exportAssets} plainView={plainAt === here} onPlainView={() => setPlainAt(here)}
            readerBar={readerBar}
          />
```
  Find:
```ts
        <ExportBodyContext value={setExportBody}>
          <HighlighterContext value={withPublish}>{body}</HighlighterContext>
        </ExportBodyContext>
```
  Replace:
```ts
        <ExportBodyContext value={setExportBody}>
          <ReaderBarContext value={barSlot}>
            <HighlighterContext value={withPublish}>{body}</HighlighterContext>
          </ReaderBarContext>
        </ExportBodyContext>
```
  (`DocsHead` takes `readerBar` in Task 6; until then the prop is a type error, so Steps 3 to 5 commit with Task 6's prop line added to `DocsHead`'s props only: `readonly readerBar?: ReaderBar | null;` after `onPlainView`, with its docstring, "A ready frame on ccrc's bar (`docs/readerBar.ts`); absent or `null`: no frame on this page takes commands.", and `import type { ReaderBar } from './readerBar';`. Task 6 reads it.)
- [ ] **Step 5: Green.** `reader-frame` its BASE count plus 9; `docs-screen`, `docs-compact-head`, `docs-scans`, `reader-lab-run`, `app-lazy` at BASE; `TSC-OK`; `( cd server && ./node_modules/.bin/vitest run test/rings test/census-w7 )` green (a red census in a file outside this wave's Scope is a stop-and-ask).
- [ ] **Step 6: Commit.** `git add pwa/src/docs/readerBar.ts pwa/src/docs/ReaderFrame.tsx pwa/src/screens/DocsScreen.tsx pwa/src/docs/DocsHead.tsx pwa/test/reader-frame.test.tsx` (expect 5), message `pwa: a frame mounted at a phone's width is on ccrc's bar, and its handle reaches the head at ready (docs library 1.1 take-up)`, trailer.

**Mutation rows this task contributes** (pkg `pwa`, tests `test/reader-frame.test.tsx`):

| id | spec | file | old → new | expected red (prediction) |
|---|---|---|---|---|
| L11-T5-M1 | (f) | `src/docs/ReaderFrame.tsx` | `const chrome = cur.barSlot?.chrome ?? 'frame-bar';` → `const chrome = 'frame-bar' as const;` | 6+ failed — cases 1, 3 to 7 |
| L11-T5-M2 | (i) | `src/docs/ReaderFrame.tsx` | `{state.s === 'ready' && bar !== null && <ReaderBarShown bar={bar} />}` → `{bar !== null && <ReaderBarShown bar={bar} />}` | 1 failed — `'the bar is published at ready, not before'` |
| L11-T5-M3 | (i) | `src/docs/readerBar.ts` | `return () => slot.publish(null);` → `return undefined;` | 1 failed — `'a fallback after ready withdraws the bar, and so does an unmount'` |
| L11-T5-M4 | (h) | `src/docs/ReaderFrame.tsx` | `title: readerBarTitle(outcome.result.meta.title, leafName(cur.props.show.path)),` → `title: leafName(cur.props.show.path),` | 1 failed — `'the bar\'s title is the document\'s own …'` |
| L11-T5-M5 | (i) | `src/docs/ReaderFrame.tsx` | `...(progress === null ? {} : { onProgress: (share: number) => progress.set(share) }),` → `...(progress === null ? {} : { onProgress: () => undefined }),` | 1 failed — `'progress reaches the bar\'s store …'` |
| L11-T5-M6 | (i) | `src/docs/readerBar.ts` | `for (const l of listeners) l();` → *(deleted)* | 1 failed — the same |
| L11-T5-M7 | (f) | `src/screens/DocsScreen.tsx` | `({ chrome: readerChromeFor(compactWidth), publish: setReaderBar })` → `({ chrome: readerChromeFor(false), publish: setReaderBar })` | 1 failed — `'the Docs screen asks for ccrc\'s bar under the compact width …'` |

```json
[
  {"id": "L11-T5-M1", "spec": "(f)", "pkg": "pwa", "file": "src/docs/ReaderFrame.tsx", "old": "const chrome = cur.barSlot?.chrome ?? 'frame-bar';", "new": "const chrome = 'frame-bar' as const;", "tests": ["test/reader-frame.test.tsx"], "red": "6+ failed: cases 1 and 3 to 7 of ccrc's bar"},
  {"id": "L11-T5-M2", "spec": "(i)", "pkg": "pwa", "file": "src/docs/ReaderFrame.tsx", "old": "{state.s === 'ready' && bar !== null && <ReaderBarShown bar={bar} />}", "new": "{bar !== null && <ReaderBarShown bar={bar} />}", "tests": ["test/reader-frame.test.tsx"], "red": "1 failed: the bar is published at ready, not before"},
  {"id": "L11-T5-M3", "spec": "(i)", "pkg": "pwa", "file": "src/docs/readerBar.ts", "old": "return () => slot.publish(null);", "new": "return undefined;", "tests": ["test/reader-frame.test.tsx"], "red": "1 failed: a fallback after ready withdraws the bar, and so does an unmount"},
  {"id": "L11-T5-M4", "spec": "(h)", "pkg": "pwa", "file": "src/docs/ReaderFrame.tsx", "old": "title: readerBarTitle(outcome.result.meta.title, leafName(cur.props.show.path)),", "new": "title: leafName(cur.props.show.path),", "tests": ["test/reader-frame.test.tsx"], "red": "1 failed: the bar's title is the document's own, else the file name"},
  {"id": "L11-T5-M5", "spec": "(i)", "pkg": "pwa", "file": "src/docs/ReaderFrame.tsx", "old": "...(progress === null ? {} : { onProgress: (share: number) => progress.set(share) }),", "new": "...(progress === null ? {} : { onProgress: () => undefined }),", "tests": ["test/reader-frame.test.tsx"], "red": "1 failed: progress reaches the bar's store and its listeners"},
  {"id": "L11-T5-M6", "spec": "(i)", "pkg": "pwa", "file": "src/docs/readerBar.ts", "old": "for (const l of listeners) l();", "new": "", "tests": ["test/reader-frame.test.tsx"], "red": "1 failed: progress reaches the bar's store and its listeners"},
  {"id": "L11-T5-M7", "spec": "(f)", "pkg": "pwa", "file": "src/screens/DocsScreen.tsx", "old": "({ chrome: readerChromeFor(compactWidth), publish: setReaderBar })", "new": "({ chrome: readerChromeFor(false), publish: setReaderBar })", "tests": ["test/reader-frame.test.tsx"], "red": "1 failed: the Docs screen asks for ccrc's bar under the compact width"}
]
```

**Verify:** as Step 5.

### Task 6: The one bar in the Docs header (refinements (f), (h), (j), (k), (l); L4)

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus` (the page's truth, names, focus and the tap's own command).

**Files:**
- Modify: `pwa/src/docs/DocsHead.tsx`, `pwa/src/docs/docsHeadWords.ts` (the existing L1 layout owner), `pwa/src/docs/docsText.ts` (one map), `pwa/src/docs/docs.css` (one block), `pwa/design/audit.mjs` (two grounds), `pwa/test/docs-compact-head.test.tsx` (the table), `pwa/test/docs-compact-css.test.ts` (one describe), `pwa/test/tap-targets.test.tsx` (the loop line and two describes), `pwa/test/control-census.test.ts` (two entries).
- Create: `pwa/test/docs-one-bar.test.tsx`.
- Guards (not edited): `pwa/test/contrast.test.ts`, `pwa/test/markup-census.test.ts`, `pwa/test/docs-scans.test.ts`, `pwa/test/docs-truth.test.tsx`, `pwa/test/refined-phone.test.tsx`, `pwa/test/shell-css.test.ts`, `pwa/test/motion-reduced.test.ts`, `pwa/test/icon.test.tsx`.

**Interfaces:** Consumes Tasks 3 and 5. Produces `HeadLayout` = `'full' | 'compact' | 'one-bar'`, `headLayoutFor(compactWidth, page, takesCommands)`, `DOCS_TOOL_TEXT: Record<ReaderCommand, string>`, and in `DocsHead.tsx` `moreName`, `CompactWhere`, `OneBar`, `ReadLine`.

- [ ] **Step 1: Tests, red first.**
  - `pwa/test/docs-compact-head.test.tsx`: the table case's rows take a third column, `takesCommands` (Find, origin/main `ce55b1ca9`):
```ts
    [true, '/docs/demo/specs/a.md', 'compact'],
    [true, '/docs/demo/specs/d/x.md?ref=main', 'compact'],
    [true, '/docs/demo/specs/d/', 'full'],
    [true, '/docs/demo/specs', 'full'],
    [true, '/docs/demo', 'full'],
    [true, '/docs', 'full'],
    [false, '/docs/demo/specs/a.md', 'full'],
  ] as const)('compact width %s, %s: %s', (compactWidth, url, want) => {
    expect(headLayoutFor(compactWidth, pageAt(url))).toBe(want);
```
  Replace:
```ts
    [true, '/docs/demo/specs/a.md', false, 'compact'],
    [true, '/docs/demo/specs/d/x.md?ref=main', false, 'compact'],
    [true, '/docs/demo/specs/d/', false, 'full'],
    [true, '/docs/demo/specs', false, 'full'],
    [true, '/docs/demo', false, 'full'],
    [true, '/docs', false, 'full'],
    [false, '/docs/demo/specs/a.md', false, 'full'],
    [true, '/docs/demo/specs/a.md', true, 'one-bar'],
    [false, '/docs/demo/plans/p.md', true, 'one-bar'],
    [true, '/docs/demo/specs/d/', true, 'full'],
    [true, '/docs/demo/specs', true, 'full'],
  ] as const)('compact width %s, %s, takes commands %s: %s', (compactWidth, url, takesCommands, want) => {
    expect(headLayoutFor(compactWidth, pageAt(url), takesCommands)).toBe(want);
```
  - Create `pwa/test/docs-one-bar.test.tsx` (header: what it holds, as the compact head's test file says it; reuse `docsFixtures`' `fakeLoaders`, `okTree`, `okFile`, `pageAt`, the `atWidth` form and the `Routed` screen; a reader whose `render` answers a rendered outcome whose `meta.title` is `'Doc title'`, whose `mount` records the input and returns `{ destroy, setPrefs, command: vi.fn() }`; a helper that opens a leaf at `atWidth(412)`, waits for the mount and calls `act(() => input.onReady())`):
    1. `'a ready frame on ccrc\'s bar turns the row into the one bar: back, the title, Quick jump, Contents'`: `.docs-head.docs-one-bar` drawn; the bar's buttons, in order, are named `DOCS_HEAD_TEXT.back`, a name that starts with the where line's text and contains `'Doc title'`, `DOCS_TOOL_TEXT.jump`, `DOCS_TOOL_TEXT.contents`; no button named Share, Export or `^Page details` on the bar.
    2. `'a plan\'s leaf adds Outline after Contents'` (`/docs/demo/plans/p.md`).
    3. `'each tool runs its command in the tap itself'`: `fireEvent.click` on Quick jump, then, with no `await` between, `command` called once with `'jump'`; likewise Contents and (on a plan) Outline.
    4. `'the title opens the details panel: the crumbs, the truth line and the full header\'s actions, in §4.5\'s order'`: the title's `aria-expanded` `'false'` and its `aria-controls` names a hidden region; a click → `'true'`, the region shown, holding the crumbs `nav`, `.docs-truth`, and a `.docs-actions` whose controls read, in order, View on GitHub, Share, Export (its words), Open committed version where offered.
    5. `'Escape from inside the panel, or on the title, closes it with focus on the title'`.
    6. `'the title\'s name carries the freshness words'`: on a never-fetched tree the title's accessible name ends with `DOCS_HEAD_TEXT.moreNever`; the dot is `aria-hidden`.
    7. `'the reading line shows the share the frame reports'`: `act(() => input.onProgress!(0.5))` → `.docs-read`'s inline size `'50%'`; `(1)` → `'100%'`; `aria-hidden="true"`.
    8. `'a fallback withdraws the one bar: the row comes back, with Page details'`: `act(() => input.onFallback('error'))` → no `.docs-one-bar`; a button named `^Page details` present.
    9. `'Updated to stays under the bar, outside the panel'`: `DocsHead` rendered directly at `atWidth(412)` with a ready `readerBar` and a visit whose `updatedTo` is a commit → `.docs-updated` inside `.docs-one-bar` and not inside the panel.
    10. `'the where line keeps a served ref and a draft badge above the title'`: a ref view of a draft leaf → `.docs-one-bar .docs-title .docs-compact-where .docs-badge` reads `ENTRY_BADGE_TEXT`'s word.
    11. `'before ready, and at a wide width with no frame on ccrc\'s bar, the head is as before'`: before `onReady`, the compact row; at `atWidth(1280)` the full header, and the input's `chrome` `'frame-bar'`.
    12. `'choosing the plain view withdraws the one bar: option 1\'s row comes back, with the plain-view note under it'`: the title opens the panel; a click on its button named `DOCS_HEAD_TEXT.exportPlainView` → `.docs-reader` gone, no `.docs-one-bar`, `.docs-head.docs-compact` drawn, and `DOCS_HEAD_TEXT.exportPlainShown` shown under the row, outside its panel (refinement (f)).
  - `pwa/test/docs-compact-css.test.ts`: append a describe `'the one bar in docs.css (the take-up plan, refinements (j), (k), (l))'`: `.docs-one-bar .docs-compact-bar` `position: relative`; `.docs-title` `flex: 1 1 auto`, `min-width: 0`, `min-height: var(--tap-min)`, `background: none`; `.docs-title[aria-expanded='true']` `background: var(--bg-pressed)`; `.docs-tool` `min-height` and `min-width` `var(--tap-min)`; `.docs-read` `position: absolute`, `inset-block-end: -1px` (the bar's padding box ends above its divider, so this puts the line's bottom at the bar's), `block-size: 2px`, `background: var(--accent)`, and no `transition`, `opacity` or `height`/`margin` declaration; no selector of the block names a width (`@media` or a `px` width in the selector).
  - `pwa/test/tap-targets.test.tsx`: in the floor loop (Find: `      ruleIn(docsCss, '.docs-more'),` inside the loop) add `ruleIn(docsCss, '.docs-title'), ruleIn(docsCss, '.docs-tool'),`; after the compact head's render half (Find: `    expect(screen.getByRole('button', { name: DOCS_HEAD_TEXT.back })).toHaveClass('docs-back');` followed by `  });` `});`) append two describes: the floor half (`floorIn(docsCss, '.docs-title')` and `floorIn(docsCss, '.docs-tool')` are `var(--tap-min)`, `.docs-tool`'s `min-width` too) and the render half (a ready one bar, with the reader of `docs-one-bar.test.tsx`'s form, carries `.docs-title` on the title and `.docs-tool` on Quick jump).
  - `pwa/test/control-census.test.ts`: Find (origin/main `ce55b1ca9`): `  'docs/DocsHead.tsx <button> docs-action docs-share':` — Replace: the two entries below, then that line (so they sit after the `docs-more` entry):
```ts
  'docs/DocsHead.tsx <button> docs-title':
    "TOKEN. The one bar's title (the library 1.1 take-up plan), which opens the details panel holding the crumbs, the "
    + 'truth line and the actions.',
  'docs/DocsHead.tsx <button> docs-tool':
    "TOKEN. One of the reader's tools on the one bar (quick jump, contents, a plan's Outline), which runs the frame's command.",
```
  Run them — Expected: compile errors (the third argument, `DOCS_TOOL_TEXT`), then each new case fails.
- [ ] **Step 2: The words** (`pwa/src/docs/docsText.ts`). Find:
```ts
  worktreeOther: 'another worktree',
} as const;
```
  Replace:
```ts
  worktreeOther: 'another worktree',
} as const;

/** The reader's tools as the one bar names them (the library 1.1 take-up plan, refinement (j)): each the accessible name
 *  of an icon button, the library's own words for its bar's tools. */
export const DOCS_TOOL_TEXT: Record<ReaderCommand, string> = {
  jump: 'Quick jump',
  settings: 'Reading settings',
  contents: 'Contents',
  outline: 'Outline',
};
```
  and add `import type { ReaderCommand } from './reader/policy';` after the file's `import { isDocsFailureWord, type DocsClientSlot } from './failures';`.
- [ ] **Step 3: The head** (`pwa/src/docs/DocsHead.tsx`).
  Find:
```ts
// Under DOCS_COMPACT_QUERY (600 CSS px) a leaf page draws the compact head instead (the phone-header plan of 2026-11-03):
// one row of back, where and what, Share and Export as icons, and Page details, which opens a panel holding the crumbs,
// the truth line and the link actions (`CompactHead`). Every other page, and every page at a wider viewport, draws the
// header above as one row and one dense line (desk-nav Part B, D-8101): back, the crumbs and the actions share the row
// (GitHub, Share and Export an icon beside their words, the words giving way first when the row is short, `HeadRow`),
// and the truth line sits under it on one line.
```
  Replace:
```ts
// Under DOCS_COMPACT_QUERY (600 CSS px) a leaf page draws the compact head instead (the phone-header plan of 2026-11-03):
// one row of back, where and what, Share and Export as icons, and Page details, which opens a panel holding the crumbs,
// the truth line and the link actions (`CompactHead`). A leaf whose reader frame is ready on ccrc's bar draws the one bar
// (`OneBar`, the library 1.1 take-up plan): back, the title opening that panel with worded actions, the reader's tools,
// and the reading line; this phone-born bar remains on widening. Other pages retain the existing header: at a wider
// viewport, one row and one dense line (desk-nav Part B, D-8101), with back, crumbs and actions sharing `HeadRow`, action
// words giving way first, and the dense truth line below. A desktop-born reader keeps its frame bar on narrowing.
```
  Find: `import { pinCommit, pinFor, samePin, type DocsVisit, type FileSlot, type Freshness } from './useDocsVisit';`
  Replace:
```ts
import { pinCommit, pinFor, samePin, type DocsVisit, type FileSlot, type Freshness } from './useDocsVisit';
import { oneBarTools, type ReaderCommand } from './reader/policy';
import type { ReaderBar, ReaderProgress } from './readerBar';
```
  (Task 5 added `import type { ReaderBar } from './readerBar';`; merge the two into this one line.) In the `@ccrc/ui` import (Find: `import { Icon, useNow } from '@ccrc/ui';`) add `type IconName`. In the `./docsText` import add `DOCS_TOOL_TEXT`.
  **Policy edit in `pwa/src/docs/docsHeadWords.ts`, not DocsHead.tsx** (C16 extracted the sole owner; keep its import in DocsHead). Find:
```ts
/** Which header a page draws. */
export type HeadLayout = 'full' | 'compact';

/** The header for `page` (phone-header refinement (a)): the compact row on a leaf page at the compact width, else the full header. A
 *  directory (its URL ends in `/`), a section, a project and the index keep the full header at every width. */
export function headLayoutFor(compactWidth: boolean, page: DocsPageLocation): HeadLayout {
  return compactWidth && page.kind === 'path' && !page.dirSlash ? 'compact' : 'full';
}
```
  Replace:
```ts
/** Which header a page draws. */
export type HeadLayout = 'full' | 'compact' | 'one-bar';

/** The header for `page` (phone-header refinement (a); the library 1.1 take-up plan, refinement (f)): the one bar on a
 *  leaf whose reader frame takes commands (ready, and mounted on ccrc's bar, which only a mount at the compact width
 *  is; it stays at any later width, so the reader's tools stay reachable); else the compact row on a leaf page at the
 *  compact width; else the full header. A directory (its URL ends in `/`), a section, a project and the index keep the
 *  full header at every width. */
export function headLayoutFor(compactWidth: boolean, page: DocsPageLocation, takesCommands: boolean): HeadLayout {
  const leaf = page.kind === 'path' && !page.dirSlash;
  if (leaf && takesCommands) return 'one-bar';
  return compactWidth && leaf ? 'compact' : 'full';
}
```
  **Back in `pwa/src/docs/DocsHead.tsx`.** Find:
```ts
export function freshDot(state: FreshChipState): FreshDot {
  return state === 'ok' ? 'ok' : state === 'never' ? 'warn' : state === 'failed' ? 'failed' : null;
}
```
  Replace:
```ts
export function freshDot(state: FreshChipState): FreshDot {
  return state === 'ok' ? 'ok' : state === 'never' ? 'warn' : state === 'failed' ? 'failed' : null;
}

/** Page details' words for a dot (phone-header refinement (f)): the ⋯ button's name, and the hidden tail of the one bar's
 *  title (the take-up plan, refinement (k)). */
function moreName(dot: FreshDot): string {
  return dot === 'failed' ? DOCS_HEAD_TEXT.moreFailed : dot === 'warn' ? DOCS_HEAD_TEXT.moreNever : DOCS_HEAD_TEXT.more;
}
```
  Find:
```ts
  const compactWidth = useMediaQuery(DOCS_COMPACT_QUERY);
  // Phone-header refinement (a): a leaf page at the compact width draws one row. Keyed by the page, so a navigation closes its panel.
  if (headLayoutFor(compactWidth, page) === 'compact' && page.kind === 'path') {
```
  Replace:
```ts
  const compactWidth = useMediaQuery(DOCS_COMPACT_QUERY);
  const bar = p.readerBar ?? null;
  const layout = headLayoutFor(compactWidth, page, bar !== null);
  // The take-up plan, refinement (f): a leaf whose frame takes commands draws the one bar once the tree is `ok` (its
  // panel needs the tree); while it is not, the compact head's crumbs stand in. Keyed by the page, as the row is.
  if (layout === 'one-bar' && page.kind === 'path' && tree !== null && bar !== null) {
    return (
      <OneBar
        key={docsPageUrl(page)} page={page} visit={visit} tree={tree} bar={bar} receivedAt={receivedAt} now={now} crumbs={crumbs}
        leafImage={p.leafImage ?? null} exportBody={p.exportBody ?? null} pageStore={p.pageStore ?? null}
        exportAssets={p.exportAssets ?? null} onPlainView={p.onPlainView ?? null}
      />
    );
  }
  // Phone-header refinement (a): a leaf page at the compact width draws one row. Keyed by the page, so a navigation closes its panel.
  if (layout !== 'full' && page.kind === 'path') {
```
  Find (the compact label, `CompactLabel`):
```ts
  return (
    <p className="docs-compact-label">
      <span className="docs-compact-where">
        <span className="docs-compact-where-text">
          <span className="docs-compact-where-crumb">{p.where}</span>
          {p.refText !== null && <span className="docs-compact-where-ref">{SEP}{p.refText}</span>}
        </span>
        {p.badge !== null && <>{SEP}{p.badge.badged ? <span className="docs-badge">{p.badge.word}</span> : p.badge.word}</>}
      </span>
      <span className="docs-compact-name">{p.name}</span>
    </p>
  );
}
```
  Replace:
```ts
  return (
    <p className="docs-compact-label">
      <CompactWhere where={p.where} refText={p.refText} badge={p.badge} />
      <span className="docs-compact-name">{p.name}</span>
    </p>
  );
}

/** The label's first line, the row's and the one bar's (the take-up plan, refinement (h)): the parent crumb, a served ref
 *  that is not origin/HEAD, then the draft badge beside the text. */
function CompactWhere(p: { readonly where: string; readonly refText: string | null; readonly badge: RowBadge | null }): ReactNode {
  return (
    <span className="docs-compact-where">
      <span className="docs-compact-where-text">
        <span className="docs-compact-where-crumb">{p.where}</span>
        {p.refText !== null && <span className="docs-compact-where-ref">{SEP}{p.refText}</span>}
      </span>
      {p.badge !== null && <>{SEP}{p.badge.badged ? <span className="docs-badge">{p.badge.word}</span> : p.badge.word}</>}
    </span>
  );
}
```
  Find: `          aria-label={dot === 'failed' ? DOCS_HEAD_TEXT.moreFailed : dot === 'warn' ? DOCS_HEAD_TEXT.moreNever : DOCS_HEAD_TEXT.more}`
  Replace: `          aria-label={moreName(dot)}`
  Find (the end of `CompactRow`, the end of the file):
```ts
        {share.s === 'updating' && <p className="docs-note">{fillSentence(DOCS_HEAD_TEXT.shareBusy, { state: shareWords(share) })}</p>}
        {exportNote !== null && <p className="docs-note">{exportNote}</p>}
      </div>
    </>
  );
}
```
  Replace: the same text, then:
```ts

/** The tools' glyphs (refinement (j)): icons already vendored, so nothing is fetched. */
const TOOL_ICON: Record<ReaderCommand, IconName> = {
  jump: 'search', settings: 'settings', contents: 'layout-list', outline: 'list-checks',
};

/** The reading line (refinement (l)): the frame's share, along the bar's bottom edge. Only this element reads the store. */
function ReadLine(p: { readonly progress: ReaderProgress }): ReactNode {
  const share = useSyncExternalStore(p.progress.subscribe, p.progress.read, p.progress.read);
  return <span className="docs-read" aria-hidden="true" style={{ inlineSize: `${Math.round(share * 1000) / 10}%` }} />;
}

/** The one bar (the library 1.1 take-up plan, refinements (f) to (l)): a leaf whose reader frame is ready on ccrc's bar.
 *  Back; the title (the label's first line above the document's own title, the freshness dot before it), which opens the
 *  details panel, a disclosure as the row's Page details is; the reader's tools, each running its command in the tap
 *  itself; the reading line. The panel holds the crumbs, the truth line and the full header's actions, in §4.5's order.
 *  "Updated to", which answers a re-list, stays under the bar, outside the panel. No plain-view note: choosing Export's
 *  plain view unmounts the reader, which withdraws the bar, so that note is under option 1's row (refinement (f)). */
function OneBar(p: Omit<CompactProps, 'plainView'> & { readonly tree: DocsTreeOk; readonly bar: ReaderBar }): ReactNode {
  const { page, visit, tree, bar } = p;
  const file = visit.file;
  const [open, setOpen] = useState(false);
  const title = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const dot = freshDot(freshnessChip(tree, p.receivedAt, visit.freshness, p.now).state);
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !open) return;
    e.stopPropagation();
    setOpen(false);
    title.current?.focus();
  };
  return (
    <header className="docs-head docs-compact docs-one-bar">
      <div className="docs-compact-bar">
        <BackButton page={page} />
        <button
          ref={title} type="button" className="docs-title" aria-expanded={open} aria-controls={panelId}
          onClick={() => setOpen((o) => !o)} onKeyDown={onKeyDown}
        >
          <CompactWhere where={p.crumbs.at(-2)?.label ?? ''} refText={rowRefText(page, tree)} badge={rowBadge(tree, page, file)} />
          <span className="docs-compact-name">
            {dot !== null && <span className="docs-title-dot" data-tone={dot} aria-hidden="true" />}
            {bar.title}
          </span>
          <span className="sr-only">{moreName(dot)}</span>
        </button>
        {oneBarTools(page.section).map((t) => (
          <button key={t} type="button" className="docs-tool" aria-label={DOCS_TOOL_TEXT[t]} onClick={() => bar.command(t)}>
            <Icon name={TOOL_ICON[t]} size={20} />
          </button>
        ))}
        <ReadLine progress={bar.progress} />
      </div>
      <div
        id={panelId} className="docs-more-panel" role="region" aria-label={DOCS_HEAD_TEXT.more} onKeyDown={onKeyDown}
        hidden={!open}
      >
        <Crumbs key={p.crumbs.at(-1)?.href} crumbs={p.crumbs} unfold />
        <TruthLine page={page} visit={visit} tree={tree} receivedAt={p.receivedAt} now={p.now} />
        <Actions
          page={page} tree={tree} file={file} leafImage={p.leafImage} exportBody={p.exportBody} pageStore={p.pageStore}
          exportAssets={p.exportAssets} onPlainView={p.onPlainView} form="stacked"
        />
      </div>
      {visit.updatedTo !== null && (
        <p className="docs-updated" role="status">{fillSentence(DOCS_HEAD_TEXT.updatedTo, { short: shortCommit(visit.updatedTo) })}</p>
      )}
    </header>
  );
}
```
  If `markup-census.test.ts` names the `docs-updated` note (the compact head's and the one bar's) as one block written twice, extract it into one `UpdatedNote` component used by `CompactHead` and `OneBar` (the full header's own copy stays as it is); that is a restatement, not a departure.
- [ ] **Step 4: The stylesheet** (`pwa/src/docs/docs.css`). Find:
```css
.docs-more-panel { display: grid; gap: var(--sp-2); min-width: 0; padding-block-end: var(--sp-2); }
.docs-more-panel[hidden] { display: none; }
```
  Replace: the same two lines, then:
```css
/* — the one bar (the library 1.1 take-up plan): a leaf whose reader frame is ready on ccrc's bar, drawn by `OneBar` and
   decided by `headLayoutFor` alone, so no rule here keys on a width. It is the compact row's box (one tap tall, its 1 px
   divider inside) holding back, the title (`.docs-title`: the row's first line above the document's title, the
   freshness dot before it; it opens the details panel), the reader's tools (`.docs-tool`) and the reading line
   (`.docs-read`: 2 px of the accent along the bar's bottom edge, over the divider and inside the bar's height, its
   inline size the share read; an absolute box is placed against the bar's padding box, which ends above the divider,
   so `inset-block-end: -1px` brings the line's bottom to the bar's). GROUNDS: the bar, the title and the tools paint nothing, so they sit on body's
   --bg-page as the row does (design/audit.mjs registers `.docs-title` and `.docs-tool` there); an open `.docs-title`
   paints its own pressed ground and ink and is measured on it; the dot and the line paint fills and set no ink. No
   transition and no opacity: nothing here moves or fades. — */
.docs-one-bar .docs-compact-bar { position: relative; }
.docs-title {
  flex: 1 1 auto; min-width: 0; min-height: var(--tap-min);
  display: flex; flex-direction: column; justify-content: center;
  margin: 0; padding: 0 var(--sp-1); border: 0; border-radius: var(--r-md);
  background: none; color: var(--ink-primary); font: inherit; text-align: start; cursor: pointer;
}
.docs-title[aria-expanded='true'] { background: var(--bg-pressed); color: var(--ink-primary); }
.docs-title-dot {
  display: inline-block; inline-size: var(--sp-2); block-size: var(--sp-2); margin-inline-end: var(--sp-1);
  border-radius: var(--r-full); vertical-align: middle;
}
.docs-title-dot[data-tone='ok'] { background: var(--status-done); }
.docs-title-dot[data-tone='warn'], .docs-title-dot[data-tone='failed'] { background: var(--status-attention); }
.docs-tool {
  flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  min-height: var(--tap-min); min-width: var(--tap-min);
  border: 0; border-radius: var(--r-md);
  background: none; color: var(--ink-secondary);
  cursor: pointer;
}
.docs-read {
  position: absolute; inset-inline-start: 0; inset-block-end: -1px; block-size: 2px;
  background: var(--accent); pointer-events: none;
}
```
- [ ] **Step 5: The grounds** (`pwa/design/audit.mjs`). Find (origin/main `ce55b1ca9`): `  '.docs-truth': {` — Replace: the two entries below, then that line (so they sit after the `.docs-more` entry):
```js
  '.docs-title': {
    under: ['var(--bg-page)'],
    why: "the one bar's title while closed (the library 1.1 take-up plan): `background: none` in the unpainted .docs-compact-bar inside .docs-head on .docs-screen, so --bg-page, as .docs-back beside it. Open, `.docs-title[aria-expanded='true']` paints --bg-pressed with --ink-primary and is measured on that ground as a self-grounded rule of its own",
  },
  '.docs-tool': {
    under: ['var(--bg-page)'],
    why: "one of the reader's tools on the one bar (the library 1.1 take-up plan), an icon button with `background: none` in the unpainted .docs-compact-bar, so --bg-page, the .docs-more reasoning",
  },
```
- [ ] **Step 6: Green.** `docs-one-bar` 12 passed; `docs-compact-head` its BASE count plus 4 (prediction: the table grows by four rows); `docs-compact-css` BASE plus 1; `tap-targets` BASE plus 2; `control-census` green; through `ccrc test`: `contrast.test.ts`, `markup-census.test.ts`, `docs-scans.test.ts`, `docs-truth.test.tsx`, `refined-phone.test.tsx`, `shell-css.test.ts`, `motion-reduced.test.ts`, `icon.test.tsx`, `docs-screen.test.tsx`, `reader-frame.test.tsx` green; `TSC-OK`.
- [ ] **Step 7: Commit.** `git add pwa/src/docs/DocsHead.tsx pwa/src/docs/docsHeadWords.ts pwa/src/docs/docsText.ts pwa/src/docs/docs.css pwa/design/audit.mjs pwa/test/docs-one-bar.test.tsx pwa/test/docs-compact-head.test.tsx pwa/test/docs-compact-css.test.ts pwa/test/tap-targets.test.tsx pwa/test/control-census.test.ts` (expect 10), message `pwa: one bar on a phone's reader page: the title, the reader's tools and the reading line (docs library 1.1 take-up)`, trailer.

**Mutation rows this task contributes** (pkg `pwa`, file `src/docs/DocsHead.tsx` unless named):

| id | spec | old → new | tests | expected red (prediction) |
|---|---|---|---|---|
| L11-T6-M1 | (f) | `src/docs/docsHeadWords.ts`: `if (leaf && takesCommands) return 'one-bar';` → `if (compactWidth && leaf && takesCommands) return 'one-bar';` | `test/docs-compact-head.test.tsx` | 1 failed — the row `false, /docs/demo/plans/p.md, true: one-bar` |
| L11-T6-M2 | (j) | `onClick={() => bar.command(t)}` → `onClick={() => { queueMicrotask(() => bar.command(t)); }}` | `test/docs-one-bar.test.tsx` | 1 failed — `'each tool runs its command in the tap itself'` |
| L11-T6-M3 | (k) | in `OneBar`'s panel, `hidden={!open}` → `hidden` (the JSON's `old` carries the lines after it, so it matches `OneBar`'s panel and not the row's) | `test/docs-one-bar.test.tsx` | 2 failed — the panel case and the Escape case |
| L11-T6-M4 | (k) | in `OneBar`'s `onKeyDown`, `title.current?.focus();` → *(deleted)* | `test/docs-one-bar.test.tsx` | 1 failed — `'Escape from inside the panel, or on the title, closes it with focus on the title'` |
| L11-T6-M5 | (k) | `<Actions` … `/>` in `OneBar` → *(deleted)* | `test/docs-one-bar.test.tsx` | 1 failed — the panel case |
| L11-T6-M6 | (k) | `<span className="sr-only">{moreName(dot)}</span>` → *(deleted)* | `test/docs-one-bar.test.tsx` | 1 failed — `'the title\'s name carries the freshness words'` |
| L11-T6-M7 | (l) | `style={{ inlineSize: `${Math.round(share * 1000) / 10}%` }}` → `style={{ inlineSize: '0%' }}` | `test/docs-one-bar.test.tsx` | 1 failed — `'the reading line shows the share the frame reports'` |
| L11-T6-M8 | (j) | `src/docs/docs.css`: in `.docs-tool`, `min-height: var(--tap-min); min-width: var(--tap-min);` → `min-height: var(--sp-8); min-width: var(--sp-8);` | `test/tap-targets.test.tsx`, `test/control-census.test.ts` | 2+ failed — the one bar's floor half, the census's TOKEN check |
| L11-T6-M9 | (l) | `src/docs/docs.css`: in `.docs-read`, `block-size: 2px;` → `block-size: 2px; transition: inline-size 0.2s;` | `test/docs-compact-css.test.ts` | 1 failed — the one bar's declarations |
| L11-T6-M10 | (k) | `design/audit.mjs`: the `'.docs-tool': { … },` entry → *(deleted)* | `test/contrast.test.ts` | 1+ failed — `.docs-tool` has no registered ground |
| L11-T6-M11 | (f) | `src/docs/docsHeadWords.ts`: `if (leaf && takesCommands) return 'one-bar';` → `if (takesCommands) return 'one-bar';` | `test/docs-compact-head.test.tsx` | 2 failed — the rows `true, /docs/demo/specs/d/, true: full` and `true, /docs/demo/specs, true: full` |

```json
[
  {"id": "L11-T6-M1", "spec": "(f)", "pkg": "pwa", "file": "src/docs/docsHeadWords.ts", "old": "if (leaf && takesCommands) return 'one-bar';", "new": "if (compactWidth && leaf && takesCommands) return 'one-bar';", "tests": ["test/docs-compact-head.test.tsx"], "red": "1 failed: compact width false, /docs/demo/plans/p.md, takes commands true: one-bar"},
  {"id": "L11-T6-M2", "spec": "(j)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "onClick={() => bar.command(t)}", "new": "onClick={() => { queueMicrotask(() => bar.command(t)); }}", "tests": ["test/docs-one-bar.test.tsx"], "red": "1 failed: each tool runs its command in the tap itself"},
  {"id": "L11-T6-M3", "spec": "(k)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "hidden={!open}\n      >\n        <Crumbs key={p.crumbs.at(-1)?.href} crumbs={p.crumbs} unfold />\n        <TruthLine page={page} visit={visit} tree={tree} receivedAt={p.receivedAt} now={p.now} />\n        <Actions", "new": "hidden\n      >\n        <Crumbs key={p.crumbs.at(-1)?.href} crumbs={p.crumbs} unfold />\n        <TruthLine page={page} visit={visit} tree={tree} receivedAt={p.receivedAt} now={p.now} />\n        <Actions", "tests": ["test/docs-one-bar.test.tsx"], "red": "2 failed: the title opens the details panel; Escape closes it"},
  {"id": "L11-T6-M4", "spec": "(k)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "title.current?.focus();", "new": "", "tests": ["test/docs-one-bar.test.tsx"], "red": "1 failed: Escape from inside the panel, or on the title, closes it with focus on the title"},
  {"id": "L11-T6-M5", "spec": "(k)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "<Actions\n          page={page} tree={tree} file={file} leafImage={p.leafImage} exportBody={p.exportBody} pageStore={p.pageStore}\n          exportAssets={p.exportAssets} onPlainView={p.onPlainView} form=\"stacked\"\n        />", "new": "", "tests": ["test/docs-one-bar.test.tsx"], "red": "1 failed: the title opens the details panel"},
  {"id": "L11-T6-M6", "spec": "(k)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "<span className=\"sr-only\">{moreName(dot)}</span>", "new": "", "tests": ["test/docs-one-bar.test.tsx"], "red": "1 failed: the title's name carries the freshness words"},
  {"id": "L11-T6-M7", "spec": "(l)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "style={{ inlineSize: `${Math.round(share * 1000) / 10}%` }}", "new": "style={{ inlineSize: '0%' }}", "tests": ["test/docs-one-bar.test.tsx"], "red": "1 failed: the reading line shows the share the frame reports"},
  {"id": "L11-T6-M8", "spec": "(j)", "pkg": "pwa", "file": "src/docs/docs.css", "old": "min-height: var(--tap-min); min-width: var(--tap-min);\n  border: 0; border-radius: var(--r-md);\n  background: none; color: var(--ink-secondary);\n  cursor: pointer;\n}\n.docs-read", "new": "min-height: var(--sp-8); min-width: var(--sp-8);\n  border: 0; border-radius: var(--r-md);\n  background: none; color: var(--ink-secondary);\n  cursor: pointer;\n}\n.docs-read", "tests": ["test/tap-targets.test.tsx", "test/control-census.test.ts"], "red": "2+ failed: the one bar's floor half; the census's TOKEN check"},
  {"id": "L11-T6-M9", "spec": "(l)", "pkg": "pwa", "file": "src/docs/docs.css", "old": "position: absolute; inset-inline-start: 0; inset-block-end: -1px; block-size: 2px;", "new": "position: absolute; inset-inline-start: 0; inset-block-end: -1px; block-size: 2px; transition: inline-size 0.2s;", "tests": ["test/docs-compact-css.test.ts"], "red": "1 failed: the one bar in docs.css"},
  {"id": "L11-T6-M10", "spec": "(k)", "pkg": "pwa", "file": "design/audit.mjs", "old": "'.docs-tool': {", "new": "'.docs-tool-unregistered': {", "tests": ["test/contrast.test.ts"], "red": "1+ failed: .docs-tool has no registered ground"},
  {"id": "L11-T6-M11", "spec": "(f)", "pkg": "pwa", "file": "src/docs/docsHeadWords.ts", "old": "if (leaf && takesCommands) return 'one-bar';", "new": "if (takesCommands) return 'one-bar';", "tests": ["test/docs-compact-head.test.tsx"], "red": "2 failed: compact width true, /docs/demo/specs/d/, takes commands true: full; compact width true, /docs/demo/specs, takes commands true: full"}
]
```

**Verify:** as Step 6.

### Task 7: The one bar and the draw in a real engine (refinements (c), (f), (g), (j), (k), (l))

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus` (the figure's validity, what each row can and cannot see).

**Files:**
- Modify: `pwa/browser/docs-compact-head.browser.test.ts`, `pwa/browser/reader-frame.browser.test.ts`.
- Guards (not edited): `pwa/browser/app.ts`, `pwa/browser/harness.ts`, `pwa/browser/reader-lab.browser.test.ts`.

**Interfaces:** the browser files import `READER_E17_MERMAID` and `docsDrawFor` from `../src/docs/reader/policy` and `DOCS_TOOL_TEXT` from `../src/docs/docsText`; the draw rows follow the recorded arm, so a later flip of the reading needs no browser edit.

- [ ] **Step 1: `docs-compact-head.browser.test.ts`.** Header comment: rewrite its first paragraph for what it now measures (the one bar on a ready reader leaf, option 1's row on a leaf the reader does not draw, the full header at 600 and up), keeping the run line. Changes:
  - Constants: replace `PHONE_TITLE_MAX = 133` and its docstring with `ONE_BAR_TITLE_MAX = 61` ("the option 2 mockup's trimmed figure: the bar and its gap, 48, and the frame's root trimmed to 8 px; prediction 56"); keep `CONSOLE_PART_MAX`, `TAP`, `PHONE`. Add `TEXT_NAME = 'notes.txt'` and its body.
  - `answerDocs` takes the leaf's content class: `markdown` (as today) or `text` (`contentClass: 'text'`, the text body); `openView` passes it through. `openLeaf` is unchanged (it waits for the reader, which the one bar follows).
  - `measure()`: `head` becomes `'one-bar' | 'compact' | 'full'` (`.docs-one-bar` first); it also returns `frameBar` (whether the frame holds a `.topbar`) and `aaOverTitle` (whether the frame's `.aa-wrap` box intersects any client rect of the title `h1`, read with a `Range` over the h1's text), recorded and not asserted.
  - A helper `oneBar(page)` waits for `.docs-head.docs-one-bar` (30 s) after `openLeaf`.
  - Replace the describe `'a phone draws one console row above the reader …'` with `'a phone draws the one bar above a ready reader (the take-up plan, refinements (f), (g), (l))'`, each case printing an `L11-FIGURE` line:
    1. `412 x 915, Refined: the title is at most ${ONE_BAR_TITLE_MAX} px down, ${CONSOLE_PART_MAX} of them the console's`: `head` `'one-bar'`, `screenTop` 0, `frameScroll` 0, the console's part ≤ 48, `above` ≤ 61, `frameBar` false; the title button's text contains `TITLE` (the document's h1, not the file name).
    2. `412 x 915, Instrument: the one bar, and at most ${CONSOLE_PART_MAX} px of the console above the frame`.
    3. `599 x 915: still the one bar`.
    4. `412 x 915: back, the title, Quick jump and Contents, each at least one tap; the bar one tap tall with its divider; the reading line inside it`: the bar's buttons by name, each ≥ 44 x 44; the bar's height 44 ± 0.5, its divider `1px`; `.docs-read`'s box height 2 and its bottom equal to the bar's bottom ± 0.5.
    5. `412 x 915: Quick jump and Contents toggle the frame's tools from ccrc's buttons`: a tap on Contents → the frame's root (`[data-docreader-root]`) has the class `toc-open`; a second tap → it has not. A tap on Quick jump → the frame's `document.activeElement` lies inside the quick jump's element (`.jump`); a second tap → it does not. (Prediction: the library's B8.1 measured the same on Chromium.)
    6. `412 x 915: the reading line follows the frame's scroll`: at the top the line's width is under 2 % of the bar's; after the frame scrolls to its end (`scrollTo(0, document.documentElement.scrollHeight)` in the frame), within 2 s the line's width equals the bar's ± 1 px.
    7. `412 x 915: the title opens the details panel; Escape closes it, focus back on the title (refinement (k))`: the old Page details case, on `.docs-title`: the truth line visible after the tap, the panel's View on GitHub link, Share and Export buttons visible with their words; Escape from inside → closed, focus on `.docs-title`.
    8. The two refinement (g) cases of the header plan (the long-branch draft, the long directory), unchanged in what they assert, but waiting for `.docs-one-bar .docs-compact-where …` and measuring inside `.docs-title` instead of `.docs-compact-label`.
    9. `mounted at 412 x 915, then turned to 915 x 412: the one bar stays, its tools still there (refinement (f))`: after `oneBar`, `setViewportSize(915 x 412)`; `.docs-one-bar` and Quick jump still drawn; the figure printed.
  - New describe `'option 1's row stays where the reader is not up (refinement (f))'`, on the text leaf at 412 x 915: do **not** call `at()`, `openLeaf()` or `measure()` (all require the reader iframe). Use `openView` with the text content class, navigate to its URL, wait for the text CodeBlock to contain the fixture body and for `.docs-head.docs-compact`, and close the context in `finally`. Assert no reader iframe. Then transplant the old row case (back, Share, Export, Page details by name, each ≥ 44, the row 44 tall, the divider 1 px, the two lines within the row; Export's name is `DOCS_HEAD_TEXT.export` here) and the old Page details case (on `.docs-more`). Replace its reader figure with outer geometry: after opening, the text-body box begins at or below the open panel's bottom and below the closed header's bottom; after Escape the panel is hidden and focus is on `.docs-more`. Capture the closed header bottom before opening; inspect the actual text CodeBlock element, never an iframe or h1. Retain the no-page-error assertion.
  - The current `the desk head (desk-nav Part B)` describe and its fitting sweeps, long-truth/unfolded/coarse-pointer cases: unchanged in their assertions, plus `frameBar` true at 600, 768 and 1280, and at 915 x 412 opened at that size (the frame mounted at a desk width keeps its own bar).
  Run through `ccrc test` — Expected (prediction): every case green; the 412 Refined figure about 56; record every `L11-FIGURE` line, and `aaOverTitle` at 412 for the operator (Q2).
- [ ] **Step 2: `reader-frame.browser.test.ts`, the draw rows by the recorded arm.** Import `READER_E17_MERMAID` and `docsDrawFor`; `const DRAW = docsDrawFor(READER_E17_MERMAID);` (these rows open at 1280, so the frame is on its own bar and the draw is the reading's). In each row below, today's assertions stand under `DRAW === 'on-request'` (arm B) and the new ones under `DRAW === 'after-ready'` (arm A):
  - M8.B1 (Find, origin/main `ce55b1ca9`: `  it('M8.B1: the 27-channel battery inside the frame reaches neither origin, Mermaid draws on tap, and the hostile directive injects no style', async () => {`): its name becomes `… Mermaid draws (on tap, or after ready where E17 held) …`; arm A: no `.fig-render-btn` in the frame; wait (90 s) for every figure's `data-docreader-draw` to be `drawn` or `failed` with no tap; the rest of the row (figures 0-2 drawn with an svg, 3-4 drawn or failed, no hostile style, fonts, then the battery) unchanged.
  - M8.3 live (Find: `      'each once').toEqual({ guard: 1, bootstrap: 1, enhance: 1, mermaid: 1, seed: 1 });`): arm A expects `mermaid: 0` (the srcdoc carries no Mermaid script after `ready`'s mode).
  - M8.8 (Find: `    await frame.locator('.fig-render-btn').click();` followed by the `waitForFunction` line): arm A skips the click and waits for `drawn`; `live.scripts` is predicted 5 in both arms (arm A: the frame's late inline insertion of the build is the fifth); a different count is reported, and the assertion restated, not weakened.
  - The worst case (Find: `    expect(summary.head.filter((h) => h.sha256 === FRAME_MANIFEST.mermaid.sha256).length, 'the Mermaid text is inlined once (the gate passed)').toBe(1);`): arm A expects 0 (no head script is the Mermaid text) and keeps `expect(m.srcdocChars).toBeGreaterThan(FRAME_MANIFEST.mermaid.chars)` out of its arm: the 30 images, about 7 million characters of base64, keep the srcdoc over Mermaid's length in both arms, so the size says nothing about Mermaid; `srcdocChars` and `readyMs` are recorded beside BASE in the `T10-FIGURES worst` line.
  - M8.20 live: unchanged; arm A adds that no response was a `mermaid.frame-*.js` chunk (the library's gate kept the loader from being called).
  Run the whole file through `ccrc test` — Expected (prediction): its BASE count, every row green, in the arm the reading picked.
- [ ] **Step 3: The tablet and desktop deltas.** Compare the 600, 768, 1280 and 915 x 412 figures against Task 1's BASE: each within 1 px (a bigger move is a stop-and-ask).
- [ ] **Step 4: Commit.** `git add pwa/browser/docs-compact-head.browser.test.ts pwa/browser/reader-frame.browser.test.ts` (expect 2), message `pwa: the one bar and the draw, measured in Chromium (docs library 1.1 take-up)`, trailer. Record every figure in the SDD ledger.

**Mutation rows this task contributes** (pkg `pwa`; a browser row rebuilds, so `timeout -k 10 900`):

| id | spec | file | old → new | tests | expected red (prediction) |
|---|---|---|---|---|---|
| L11-T7-M1 | (g) | `src/docs/reader/bridge.ts` | `features: { chrome: { bar: false, topSpace: false } }` → `features: { chrome: { bar: false, topSpace: true } }` | `browser/docs-compact-head.browser.test.ts` | 1+ failed — case 1's `above` (about 76 against 61) |
| L11-T7-M2 | (j) | `src/docs/DocsHead.tsx` | `onClick={() => bar.command(t)}` → `onClick={() => undefined}` | `browser/docs-compact-head.browser.test.ts` | 1 failed — case 5 |

```json
[
  {"id": "L11-T7-M1", "spec": "(g)", "pkg": "pwa", "file": "src/docs/reader/bridge.ts", "old": "features: { chrome: { bar: false, topSpace: false } }", "new": "features: { chrome: { bar: false, topSpace: true } }", "tests": ["browser/docs-compact-head.browser.test.ts"], "red": "1+ failed: 412 x 915, Refined: the title is at most 61 px down"},
  {"id": "L11-T7-M2", "spec": "(j)", "pkg": "pwa", "file": "src/docs/DocsHead.tsx", "old": "onClick={() => bar.command(t)}", "new": "onClick={() => undefined}", "tests": ["browser/docs-compact-head.browser.test.ts"], "red": "1 failed: Quick jump and Contents toggle the frame's tools from ccrc's buttons"}
]
```
(The browser rows run with `--config vitest.browser.config.ts`; `tests` names the file relative to `pwa`.)

**Verify:** both files green in the recorded arm; the figure at 412 x 915 ≤ 61 px and the console's part ≤ 48 px; the deltas within 1 px.

### Task 8: The spec and design text the take-up changes

**Model routing:** `sonnet`, effort `medium`; per-task reviewer `sonnet`/`medium` (mechanical documentation; the text against what shipped, arm by arm).

**Files:** `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md`, `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md`, `docs/superpowers/specs/2026-11-03-reader-lab-design.md`.

Each edit is marked in its file's convention, `(amended 2026-11-05; library 1.1 take-up)` (the base spec's marks add the header's numbers they close). Some Replace blocks give variants by arm, from Task 1 Step 2's record: **Arm A** when `E17-READING` is `holds`; **Arm B with a block** when it is `does-not-hold`, or `not-measured` from a block whose `mermaid` line reads `not measured` (`E17-BLOCKS` 1 or more); **Arm B with no block** when `E17-BLOCKS` is `0` (the operator answered Q1 that the wave lands without one). Where a block names "**Arm B:**" alone, it serves both arm B cases. Write the one variant for the recorded arm, filling `<…>` from the SDD ledger's block lines; the no-block variants carry no `<…>` at all, because there is nothing measured to fill them with. A Replace block with one text is the same in every arm. Nothing in angle brackets reaches a file (Step 4 checks).

- [ ] **Step 1: The rich-docs spec.**
  - §4.4, the Handshake bullet. Find: `Every later parent message goes on the port, and is `prefs` or `changes.result`.` — Replace: `Every later parent message goes on the port, and is `prefs`, `changes.result`, `mermaid` or `command` (amended 2026-11-05; library 1.1 take-up).`
  - §4.4's table. Find (the row):
```text
| `changes.result` (W8b) | parent to frame | `{sha, ranges}` or `{sha, unavailable: true}` | Built by the parent. Sent on the port, once per `changes`. | The frame marks changed blocks |
```
  Replace: that row, then:
```text
| `mermaid` (library 1.1) | parent to frame | `{text}`, the library's own Mermaid build, or `{unavailable: true}` | Sent by the library's `./host` once per mount, after a valid `ready`, only to a frame seeded to draw after `ready`; the text must be the shipped build's (its sha256) and is fetched through ccrc's `loadMermaid` adapter, only for a document the Mermaid gate lets in (amended 2026-11-05; library 1.1 take-up) | The frame runs it as one inline script its policy allows by hash and draws every figure, nearest first; `unavailable` leaves every figure as its source with the load note |
| `command` (library 1.1) | parent to frame | `{name}`: `jump`, `settings`, `contents` or `outline` | Sent only from a tap on ccrc's own bar, through the library's `DocFrame.command`, which focuses the frame first and sends nothing before `ready` (amended 2026-11-05; library 1.1 take-up) | The frame toggles that tool; a tool the document lacks changes nothing |
```
  Find (the last row):
```text
| `version` (W8b) | frame to parent | `{sha?, only?}` | Each 40 or 64 hex characters | With `sha`, the parent opens the page at `at=<sha>` (R-d) and keeps `only` in `history.state` for the visit. Without `sha`, it drops `at=`: "Back to the latest". |
```
  Replace: that row, then:
```text
| `progress` (library 1.1) | frame to parent | `{p}`, the thousandths read, `'0'` to `'1000'` | Sent only to a parent that asked for it, at most four a second; ccrc asks only for a frame mounted on its own bar; any other shape is refused (amended 2026-11-05; library 1.1 take-up) | ccrc draws the share as its bar's reading line |
```
  - §4.6, the Budget bullet. Find: `With Mermaid drawn on tap (W8a), `ready` does not wait for Mermaid, so W8a's budget carries no allowance (amended 2026-10-31; operator ruling (4)).` — Replace: `With Mermaid drawn on tap (W8a), or after `ready` (the library 1.1 take-up), `ready` does not wait for Mermaid, so the budget carries no allowance (amended 2026-10-31; operator ruling (4); amended 2026-11-05; library 1.1 take-up).`
  - §4.6, the `reader-mermaid-on-tap` bullet. Find (origin/main `ce55b1ca9`, the whole bullet, one line):
```text
- **`reader-mermaid-on-tap`, W8a's default (amended 2026-10-31; operator ruling (4)).** It was a contingency for an E17 failure; you made it the default without waiting for E17, through the library's on-request draw mode. Drawing on open (ruled 2026-11-03) follows the reader lab's E17 measurement and the library change that draws after `ready` (amended 2026-11-03; reader lab). Each figure shows its source with a Render button. Mermaid runs only on that tap, one figure at a time. It mirrors base `mockup-scripts-confirm`. This stays unchanged for the Docs reader. The reader lab's own mounts draw on open through a lab-only profile with a 60 s watchdog and no storage port (M10.15) (amended 2026-11-03; reader lab).
```
  Replace, **Arm A:**
```text
- **Drawing on open, the Docs reader's default since the library 1.1 take-up (amended 2026-11-05; library 1.1 take-up).** The reader lab's E17 `mermaid` line held on your phone (§5.3), so the Docs reader mounts in the library's `after-ready` mode: the frame says `ready` with every figure as its readable source and no Mermaid script in its srcdoc; ccrc hands the library the Mermaid text through `loadMermaid`, which the library calls at mount, in parallel with the frame's boot, only for a document the Mermaid gate lets in; and the frame draws the figures nearest first. A text that does not load leaves every figure as its source with the load note, and the page stays mounted. `reader-mermaid-on-tap`, W8a's default until then (amended 2026-10-31; operator ruling (4)), stays in the reader as the arm a reading that does not hold selects: one recorded reading, `policy.ts#READER_E17_MERMAID`, decides it (`docsDrawFor`). Each figure then shows its source with a Render button, and Mermaid runs only on that tap, one figure at a time, mirroring base `mockup-scripts-confirm`. The reader lab's own mounts still draw on open in the library's `auto` mode, where `ready` waits for the figures, through a lab-only profile with a 60 s watchdog and no storage port (M10.15) (amended 2026-11-03; reader lab).
```
  Replace, **Arm B with a block:** the bullet as it stands, with this sentence inserted after `… the library change that draws after `ready` (amended 2026-11-03; reader lab).`: `The library change shipped in 1.1.0, which ccrc pins, but E17's `mermaid` line read <does not hold, with its detail | not measured> on <the engine> (§5.3), so the Docs reader keeps drawing on tap; one recorded reading, `policy.ts#READER_E17_MERMAID`, moves it to drawing after `ready` when a reading holds (amended 2026-11-05; library 1.1 take-up).`
  Replace, **Arm B with no block:** the bullet as it stands, with this sentence inserted at the same place: `The library change shipped in 1.1.0, which ccrc pins, but no E17 block had arrived from a phone when the take-up landed (§5.3), so the Docs reader keeps drawing on tap; one recorded reading, `policy.ts#READER_E17_MERMAID`, moves it to drawing after `ready` when a reading holds (amended 2026-11-05; library 1.1 take-up).`
  - §4.7, the adapters bullet. Find: `calls `mountDocFrame()` with ccrc's adapters: the storage port, the router, `copyText`, the images and the assets.` — Replace: `calls `mountDocFrame()` with ccrc's adapters: the storage port, the router, `copyText`, the images and the assets; since the library 1.1 take-up also the Mermaid text's loader for a reader that draws after `ready`, and, for a frame mounted at a phone's width, the frame's bar turned off with ccrc's own bar running its tools and drawing its progress (amended 2026-11-05; library 1.1 take-up).`
  - §5.2, the shared-process row. Find: `the operator ruled draw on open on 2026-11-03, behind a library change (amended 2026-11-03; reader lab). | Pending: UNMEASURED on phones, lab E17 |`
    - Replace, **Arm A and Arm B with a block:** `the operator ruled draw on open on 2026-11-03, behind a library change (amended 2026-11-03; reader lab). Since the library 1.1 take-up the Docs reader draws after `ready` only when E17's `mermaid` line held, and on tap otherwise (amended 2026-11-05; library 1.1 take-up). | Measured: E17 on <the engine>, <the reading> (§5.3) (amended 2026-11-05; library 1.1 take-up) |`
    - Replace, **Arm B with no block:** `the operator ruled draw on open on 2026-11-03, behind a library change (amended 2026-11-03; reader lab). The library 1.1 take-up pins 1.1.0, and the Docs reader stays on tap until E17's `mermaid` line holds (amended 2026-11-05; library 1.1 take-up). | Pending: UNMEASURED on phones, lab E17 |`
  - §5.3, E17's row. Find: `On-tap is W8a's default; auto-draw waits for this measurement (amended 2026-10-31; operator ruling (4)). |`
    - Replace, **Arm A and Arm B with a block:** `On-tap is W8a's default; auto-draw waits for this measurement (amended 2026-10-31; operator ruling (4)). Measured on <date>, on <each block's device facts>: `mermaid` <reading> (<its detail>), `busy-frame` <its fact>. Record every block with its library build, auto mode and ready window. The two 2026-11-06 blocks are 1.0.0/auto, not measurements of 1.1.0 or after-ready. Their combined reading does not hold, so the selected production draw remains on request. No cross-build or cross-mode equivalence is asserted (amended 2026-11-07; library 1.1 take-up). |`
    - Replace, **Arm B with no block:** `On-tap is W8a's default; auto-draw waits for this measurement (amended 2026-10-31; operator ruling (4)). No phone block was recorded, so the Docs reader stays on request. A future draw flip requires an identified build/mode/window and the existing all-blocks rule, not an assumed auto-to-after-ready equivalence (amended 2026-11-07; library 1.1 take-up). |`
  - §7.1, M8.6. Find: `Every other parent message goes on the port and is `prefs` or `changes.result`, any number of times.` — Replace: `Every other parent message goes on the port and is `prefs` or `changes.result`, any number of times, or, since the library 1.1 take-up, `mermaid` (once, after `ready`) or `command` (amended 2026-11-05; library 1.1 take-up).` And Find: `send an op other than `prefs` or `changes.result` on the port;` — Replace: `send an op other than `prefs`, `changes.result`, `mermaid` or `command` on the port;`
  - §8, the paragraph. Find: `it runs E17 and E18 for the retirement gate (amended 2026-11-03; reader lab).` — Replace: `it runs E17 and E18 for the retirement gate (amended 2026-11-03; reader lab). The library 1.1 take-up follows the library's 1.1.0 release and the reader lab's phone run: it pins 1.1.0, draws Mermaid after `ready` where E17 held, and gives a phone's reader page one bar (amended 2026-11-05; library 1.1 take-up).`
  - Figure 3. Find:
```text
    W8a --> RL["RL reader lab<br/>RL-a door, RL-b page"]
  end
```
  Replace:
```text
    W8a --> RL["RL reader lab<br/>RL-a door, RL-b page"]
    RL -->|"E17"| TU["1.1 take-up<br/>one bar, draw by E17"]
  end
```
  Find: `  V1 --> W8a` — Replace:
```text
  V1 --> W8a
  V1 --> V11["v1.1.0 published<br/>after-ready, one bar"] --> TU
```
  Figure 3's caption: Find: `RL, the reader lab, needs W8a only and feeds the retirement gate with E17 and E18 (amended 2026-11-03; reader lab).` — Replace: that sentence, then ` The 1.1 take-up needs the library's v1.1.0, and takes its draw from the reader lab's E17 reading: after `ready` where the `mermaid` line held, on tap otherwise (amended 2026-11-05; library 1.1 take-up).` (The figure's node is labelled "draw by E17", and its caption says both draws, so Figure 3 has one text in every arm.)
  - §8's table. Find (the RL row): the line starting `| RL | RL reader lab: RL-a door, RL-b page (amended 2026-11-03; reader lab).` — Replace: that row, then:
```text
| 1.1 take-up | The library's 1.1.0 in ccrc (amended 2026-11-05; library 1.1 take-up): the exact pin at 1.1.0 with M8.12 and M8.16 carried; Mermaid drawn after `ready` where E17's `mermaid` line held, on tap otherwise; on a phone, a reader page's one bar (the frame's bar off and its top space trimmed, its quick jump, contents and a plan's Outline on ccrc's buttons, its progress drawn by ccrc, the document's title, the details behind it) | W8a, RL (E17), library 1.1.0 | M8.6 as amended, and the take-up plan's rows | Ruled 2026-11-03 (draw on open; the phone header's option 2 with the library release) |
```
  - §10, RD14. Find: `8 frame-to-parent ops and 3 parent-to-frame ops (6 and 2 in W8a, the rest with W8b);` — Replace: `9 frame-to-parent ops and 5 parent-to-frame ops (6 and 2 in W8a; `progress`, `mermaid` and `command` with the library 1.1 take-up, `mermaid` only while the Docs reader draws after `ready`; the rest with W8b) (amended 2026-11-05; library 1.1 take-up);`
  - Where things stand, Later. Find: `- Mermaid drawn on open in the reader (ruled 2026-11-03), after the reader lab's E17 measurement and the library change (amended 2026-11-03; reader lab).` — Replace, **Arm A:** `- Mermaid drawn on open in the reader shipped with the library 1.1 take-up, after E17 held (amended 2026-11-05; library 1.1 take-up).` **Arm B:** `- Mermaid drawn on open in the reader (ruled 2026-11-03): the library change shipped in 1.1.0 and ccrc pins it; the reader moves to it when an E17 reading holds, by one recorded reading (amended 2026-11-05; library 1.1 take-up).` (The sentence after it, on the colouring divergences, stays.)
  - Where things stand, Agreed. Find: `You ruled this on 2026-10-31 (RD24, RD34). Retiring the standalone docs server stays a separate later gate.` — Replace: that text, then a new bullet: `- The library 1.1 take-up: the pin at 1.1.0, Mermaid drawn after `ready` where E17 held, and a phone's one bar, as its plan's answers Q1 to Q3 record (amended 2026-11-05; library 1.1 take-up).`
- [ ] **Step 2: The base spec** (`2026-10-01-native-docs-reader-design.md`).
  - The header. Find: `**Supersedes:** the 2026-08-22 tooling decision brief's T3` — Replace: a new paragraph, then that text:
```text
**Amended 2026-11-05: the phone header.** Written in place, in the same way. It folds in the phone header's two waves: option 1, one console row on a phone's leaf (the phone header plan of 2026-11-03, whose departures D-7953, D-7954 and D-7955 the operator approved plan-only on 2026-11-04, to be amended here in one place once option 2 landed), and option 2, one bar on a phone's reader page (the library 1.1 take-up plan of 2026-11-05). It touches §4.4 (the Layout sentence and the Leaf row), §4.5 (Share and Export), §4.7 (Placement) and §4.17 (When it is offered). Each amended place is marked "(amended 2026-11-05; the phone header)".

**Supersedes:** the 2026-08-22 tooling decision brief's T3
```
  - §4.4, Layout. Find: `**Layout.** Phone (<900 px): one column, breadcrumb of the last two crumbs behind a leading `…` button, truth-line facts inline joined by ` · ` with `overflow-wrap: anywhere`.` — Replace: that text, then: ` Under 600 px a leaf page draws one row instead (amended 2026-11-05; the phone header, D-7953 to D-7955): back, a two-line label naming where and what, Share and Export as icons, and Page details, which opens a panel in the page's flow holding the crumbs (every one a link), the truth line and the link actions; the label's first line keeps a served ref that is not origin/HEAD and a draft's badge, and while the tree slot is not `ok` the head is back and the crumbs. Once a leaf's reader frame is ready and was mounted at that width, the row is the one bar (the library 1.1 take-up): back; the document's title, the label's first line above it and the freshness dot before it, which opens the same panel, then holding Share and Export in §4.5's order; the reader's quick jump and contents, and a plan's Outline, as ccrc's buttons; and the reading progress along its bottom edge. The frame's own bar is off there, and the one bar stays at any later width, so the reader's tools stay reachable.`
  - §4.4, the Leaf row. Find: `| Leaf | tree, then file | Truth line, banners, actions (§4.5; Share and Export, §4.16, §4.17).` — Replace: `| Leaf | tree, then file | Truth line, banners, actions (§4.5; Share and Export, §4.16, §4.17; under 600 px the truth line and the link actions are one tap away, in Page details or behind the one bar's title: amended 2026-11-05; the phone header).`
  - §4.5, Share. Find: `- **Share** sits after View on GitHub and before Open committed version, on project, section, directory and leaf pages. It is never on the index, and never in `frame=full`, which has no header.` — Replace: that text, then: ` On a phone's leaf (§4.4's Layout) Share and Export are icons on the row, their words the icons' accessible names and a line in Page details, and the two links are in Page details; on the one bar all four are in the panel the title opens, in this order and with their words (amended 2026-11-05; the phone header, D-7955).`
  - §4.5, When they are available. Find: `On a leaf both are disabled while the opened pin differs from `pinFor(tree, page)` (§4.3), reading "Updating to <short>…".` — Replace: `On a leaf both are disabled while the opened pin differs from `pinFor(tree, page)` (§4.3), reading "Updating to <short>…" (on a phone's row, as the icon's accessible name and a line in Page details: amended 2026-11-05; the phone header).`
  - §4.7, Placement. Find: `a file failure replaces the body and keeps the header and truth line;` — Replace: `a file failure replaces the body and keeps the header and truth line (on a phone's leaf the truth line is in Page details, one tap away: amended 2026-11-05; the phone header, D-7954);`
  - §4.17. Find: `and for `html` (W6) means the plan is done (§5.6.9). Otherwise:` — Replace: `and for `html` (W6) means the plan is done (§5.6.9). On a phone's row the disabled words below are the Export icon's accessible name and a line in Page details, and on the one bar they are the words of the panel's Export button (amended 2026-11-05; the phone header, D-7955). Otherwise:`
- [ ] **Step 3: The reader lab design** (`2026-11-03-reader-lab-design.md`).
  - §8. Find: `After the library change, `ready` no longer waits for figures, so a window that ends at `ready` would time none of the draw, and 'the same page re-measures it' would be false` — Replace: `For an after-ready profile, ready does not wait for figures, so a window ending at ready cannot measure its draw; a new mode/window measurement is required before claiming that timing. The existing auto profile still waits for figures and keeps its ready window`. Then Find: `The library change flips the mode in its own change; if it adds a drawn signal of its own, the window ends there instead.` — Replace: `The library shipped after-ready as a third mode in 1.1.0 and left auto unchanged. The lab retains auto/ready for comparability; it does not prove after-ready timing or a cross-build bound. Any future after-ready profile needs ready-and-settle or a library drawn signal and its own identified measurement (amended 2026-11-07; library 1.1 take-up, refinement (d)).`
  - RL14. Find: `| A mode: `ready` for library 1.0.0, `ready-and-settle` for the library change, which flips it |` — Replace: `| A mode: `ready` while the lab draws in the library's `auto` mode (1.0.0, and 1.1.0, whose change left `auto` as it was), `ready-and-settle` for a lab profile that draws after `ready` (amended 2026-11-05; library 1.1 take-up, refinement (d)) |`
  - Later. Find: `it switches the lab's gap window to `ready-and-settle` (or to a drawn signal of its own), and the lab re-measures it once it ships.` — Replace: `it shipped in 1.1.0 as after-ready, while the lab retains auto/ready for comparability. Before a future after-ready timing claim or draw flip, measure the actual build/mode with ready-and-settle or a drawn signal; the old auto blocks are not that evidence (amended 2026-11-07; library 1.1 take-up).`
  - The header's `**Revisions:**` line, which lists every 2026-11-05 amendment by its source (the design's own convention). Find (origin/main `d32c339d3`, the merge of #2345, which rewrote this line; the dispatch base carries it, so the find-check matches it there):
```text
and review 1468's residue (A3, F1).
```
  Replace:
```text
and review 1468's residue (A3, F1); and the library 1.1 take-up (its plan's refinement (d)): §8, RL14 and Later, the lab staying on `auto` with its window at `ready`.
```
- [ ] **Step 4: Check.** `git diff --stat` shows the three specs only; every `Find` replaced once; no `<…>` left in a file: `git diff -- docs/superpowers/specs | grep '^+' | grep -nE '<(the |each |date>|reading>|its |does not)'` prints nothing (run before Step 5 stages them; the pattern covers every placeholder Task 8's Replace blocks carry: `<the engine>`, `<the reading>`, `<each block's device facts>`, `<date>`, `<reading>`, `<its detail>`, `<its fact>` and `<does not hold, with its detail | not measured>`, and none of the specs' own `<short>`, `<sha>` or `<br/>`); the Mermaid figure renders (paste its block into the docs server's preview or a Mermaid renderer offline; no semicolon in a label).
- [ ] **Step 5: Commit.** `git add` the three specs (expect 3), message `docs: the rich-docs, base and reader lab specs amended for the library 1.1 take-up (docs library 1.1 take-up)`, trailer.

**Mutation rows:** none (text only; Task 10's review reads it against what shipped).

**Verify:** as Step 4.

### Task 9: Settings — discoverable Reader lab and Measure highlighting

**Model routing:** `sonnet`, effort `high`; per-task reviewer `opus`, effort `high` (navigation and access contract).

**Files:** Modify `pwa/src/screens/settings/SettingsIndex.tsx`. Test `pwa/test/settings-frame.test.tsx`, `pwa/test/settings-screen.test.tsx`, `pwa/test/command-layer.test.tsx`, `pwa/test/command-registry.test.ts` only for these two existing diagnostic doors. No new route, command ID, section enum, storage or API.

**Interfaces:** consume the existing `commandDoor(id)` contract and current diagnostic routes. Produce exactly two diagnostic anchors after the five ordinary `SETTINGS_SECTIONS.map` rows:

| Label | href | data-command / commandDoor id | Purpose |
|---|---|---|---|
| Reader lab | `/settings/reader-lab` | `go-reader-lab` | Measure reader responsiveness and sandbox checks on this device. |
| Measure highlighting | `/settings/measure-highlighting` | `go-measure-highlighting` | Measure code-highlighting performance on this device. |

They are diagnostics, not new `SETTINGS_SECTIONS`. Give them `data-diagnostic`, not `data-section`, so ordinary-section assertions remain exact. Do not fabricate health/status badges. Reuse the existing Settings row classes/tokens and anchor semantics. A normal click prevents default and invokes the named command; meta/ctrl/shift/alt clicks do not prevent default or invoke the command, so the real href remains usable.

- [ ] **Step 1: Write the failing cases.** In `settings-frame.test.tsx`, scope the existing five-section assertion to ordinary section rows, keep its exact five IDs/order/status assertions, then add `Reader lab is discoverable after the ordinary sections` and `Measure highlighting is discoverable after the ordinary sections`. Each asserts one visible link with the exact label and purpose (the combined accessible name may include both), href, data-command and position after all five rows. Scope every old five-link assertion, including the unknown-id fallback case, to `a[data-section]`, not all anchors; separately assert exactly two diagnostics and seven total links. In the existing command/Settings suites add an actual click-through assertion for each route and normal versus all four modified clicks. Assert `SETTINGS_SECTIONS` still has five members. Do not replace a specific ordinary-row assertion with a permissive total.
- [ ] **Step 2: Run to RED.** From pwa, `./node_modules/.bin/vitest run test/settings-frame.test.tsx test/settings-screen.test.tsx test/command-layer.test.tsx test/command-registry.test.ts`. Expected assertion failure: each diagnostic link is absent at baseline. A missing import/test setup error is not the red.
- [ ] **Step 3: Add the two diagnostic anchors.** Keep the ordinary map untouched. Add only these two rows below it, using the existing commandDoor/href click idiom and purpose text above. Do not change the lab, highlight instrument, app route/command grammar or ordinary Settings status computation.
- [ ] **Step 4: GREEN and navigation verification.** Run the same four suites, PWA typecheck and relevant control/tap/markup/command censuses. Include the complete browser suite at Task 10 so navigation/access additions cannot hide another bar overflow. If an extra census/import path is needed outside the claimed task scope, ask for scoped leave first, never edit it silently.
- [ ] **Step 5: Independent guard mutations.** Save/hash/restore sequentially. `L11-T9-M1`: remove or misroute only the Reader lab row; its exact door/route case must fail while the highlighting case still holds. `L11-T9-M2`: remove or misroute only Measure highlighting; its case must fail while Reader lab still holds. Record actual unique old/new snippets and the two JSON rows under the common schema before committing; predictions are one-or-more named assertion failures, not invented measured counts. Also mutate the modified-click guard once (`L11-T9-M3`) and prove the relevant click case reds. Record Task 9's table and JSON fence under the same schema as the other tasks; old close labels are historical, not renumbered evidence.
- [ ] **Step 6: Commit.** Stage these named source/tests only, message `feat: expose reader and highlighting diagnostics in Settings (docs library 1.1 take-up)`, standing attribution. Task 10's Results/brief/PR must name this owed access correction.


**Task 9 assertion shape** (use the existing `pendingReads`, `renderSettings`, `index` helpers, no new production test seam):

```tsx
it('Reader lab is discoverable after the five ordinary sections', () => {
  pendingReads();
  renderSettings(null);
  const nav = index();
  const ordinary = nav.querySelectorAll('a[data-section]');
  expect(ordinary).toHaveLength(5);
  const lab = within(nav).getByRole('link', { name: /^Reader lab/ });
  expect(lab).toHaveAttribute('href', '/settings/reader-lab');
  expect(lab).toHaveAttribute('data-command', 'go-reader-lab');
  expect(lab).not.toHaveAttribute('data-section');
  expect(ordinary[4]!.compareDocumentPosition(lab) &
    Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```

The highlighting case uses the table's exact label/href/command. Test normal and modifier clicks separately; the fixture above is the missing-link red, not a substitute for route integration.

**Verify:** five ordinary sections unchanged; two separately tested diagnostics; exact href/command/route wiring, purpose copy and ordinary/modified clicks green; independent measured mutation rows and restores recorded.

### Task 10: Close — review, suites, the mutation table, results, push and the one PR

**Model routing:** the main loop (Opus); review lenses as below; `sonnet` subagents for the runs.

- [ ] **Step 1: Whole-branch review (held out).** Use three `opus`/`high` lenses over `BASE..HEAD` against this plan: (1) the pin and the draw (refinements (a) to (e)); (2) the one bar's truth and interaction (refinements (f) to (l)); (3) layout and the measurement (Task 7's figures, the widened phone, tablets and desktops unchanged, the stylesheet keyed on classes). Assign tests/rows/censuses/spec/privacy and Task 9 Settings access across the three lenses. Each critical/important finding gets three `sonnet`/`high` refuters with majority adjudication; each minor gets one advisory refuter. Record actual identities; a missing/dead/mismatched lens is unverified. Confirmed findings are fixed one commit each, each with a test or independently measured guard row. This internal pass does not replace the coordinator's separate review run.
- [ ] **Step 2: Suites**, each in the foreground through `ccrc test`, split to fit: the whole `pwa` suite in pieces and `TSC-OK`; the complete PWA browser suite locally, including both reader/header files and navigation, with actual executed counts; `git fetch -q origin main`, then the whole `server` suite in pieces (`docs-parity`, `ci-pipeline`, `citations`, `topology-clean`, `rings`, `census-w7`, `typecheck-tests` among them; the PR's CI runs it all anyway, the lock having changed), `typecheck-tests` alone. A red census in a file outside Scope is a stop-and-ask. Re-run a known load flake alone first.
- [ ] **Step 3: The whole mutation table** at the end state, in the workspace, sequentially, under the low-disk discipline; keep the last occurrence of each id; every row red, every restore sha-checked, `git status --porcelain` clean after the last row.
- [ ] **Step 4: Reconcile the deviations.** Copy the coordinator's already-issued-and-defined run-open entry into `## Deviations found`: first refinement (d), whose entry names the lab design's exact window-flip sentences and the unmeasured after-ready boundary, then any found while executing (entry form: `- **D-<n> (<date>)** — <slug>. <what departs from which sentence, and why>. <Task and rows that apply it>.`); write the unused ones without their prefix. Commit, then `git fetch -q origin main && ( cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts )` green.
- [ ] **Step 5: Draft `## Results`** in this plan: the counts per suite; every task's JSON row fence as measured; the E17 reading and the arm; every `L11-FIGURE` line beside Task 1's BASE (the figure at 412 x 915 against 61, the console's part against 48, `aaOverTitle`, the widened case, the tablet and desktop deltas); the `T10-FIGURES worst` line at BASE and at the end; "Named, without a number"; "Carried, not fixed". Draft the PR body into `.superpowers/sdd/2026-11-05-native-docs-reader-library-1-1-take-up/pr-body.md`: title `Docs: the shared library at 1.1.0, one bar on a phone's reader page, and Mermaid drawn after ready where E17 held`; what ships, per arm; the figure before and after; the departure by letter with its number; the operator's answers to Q1 to Q3; the two visible Settings diagnostics and access correction; the review's findings and fixes; the test plan.
- [ ] **Step 6: Public-repo scan** of every file changed since BASE as it stands, the uncommitted plan and the drafted PR body: rc 0, zero hits. Remove `$HOME/.cc-tmp/l11-mut/`.
- [ ] **Step 7: Commit the results, last.** Stage this plan by name, message `docs: the library 1.1 take-up's results (docs library 1.1 take-up)`, trailer. This commit is the `handoffCommit` and the branch tip.
- [ ] **Step 8: Push** the workspace branch and open the ONE pull request with the scanned body (`gh pr create --body-file`).
- [ ] **Step 9:** Measure the fingerprint (`handoffCommit === branchTip`, the PR number, `prPhase: 'open'`), wait for the PR's CI run on that exact tip (its `test (server)` runs the full suite; read the `CodeQL` check itself, not only its Analyze jobs), list mail, then send the wave-done.

## Deviations found

Known departure (d) is allocated and defined by the coordinator in one act before dispatch. Task 10 Step 4 copies that definition and reconciles the issued reserve; no number is invented here.

## Where things stand

### Agreed
- From the library's release, not a choice: 1.1.0 adds `after-ready`, `loadMermaid`, the bar-off reader with `onProgress` and `DocFrame.command`, and moves four asset hashes and `frameCsp()`'s output; bridge protocol 1 and seed schema 1 are unchanged.
- From the base: ccrc pins no frame hash and no srcdoc cap by hand, so the bump re-pins nothing; M8.16 reads the lock and carries over unchanged (refinement (a)).
- From the operator's rulings: draw Mermaid on open, following E17 (2026-11-03); the phone header's option 2 with the library release (2026-11-03, 2026-11-04); the library's Q5, Q8 and Q9 (2026-11-04).
- From the header plan: option 2's details live behind the title, in the same disclosure option 1 uses (its Q2), and desktops and tablets keep today's header.

### Answered by the operator (2026-11-06)

Console item 48 approved every recommendation below. These questions and alternatives are retained for audit; none remains unanswered. The two phone blocks above select on request under Q1.

- **Q1. When does the Docs reader draw Mermaid on open?** The rich-docs spec makes drawing on open follow E17. The operator supplied the two phone blocks above for console item 53 (replacing withdrawn item 47).
  - **Recommended:** on open (after `ready`) only when every block you send reads `holds` on its `mermaid` line; if any reads `does not hold`, or none is measured, the reader keeps drawing on tap as today. If no block has arrived when the library's tag is published, the wave lands on tap and a one-line follow-up (the recorded reading, its pin and the spec's E17 sentence) flips it when a block that holds arrives. Why: the reading is one recorded constant (refinement (b)), the on-tap arm stays in the reader, and the `busy-frame` line is a fact, not a condition, as E17's pass cell says.
  - Alternatives: (b) your own phone's block decides alone, and a second browser's block is recorded only; (c) draw on open whatever E17 reads, as the library batch accepted the risk with the gate's caps as the bound (its Q5), with the lab's reading recorded; this departs from the rich-docs spec's §4.6 sentence ("Drawing on open (ruled 2026-11-03) follows the reader lab's E17 measurement") and its E17 row, so it would need its own number (issued at run-open from the reserve) and a spec amendment of both in Task 8, which this plan does not yet write; (d) hold the whole wave until a block arrives.
- **Q2. Aa, the reading settings, on the one bar.** With the frame's bar off, the library draws its own Aa at the frame's top right (sticky, 34 px tall), and `chrome.settings: false` would remove the reading settings altogether (width, font, the product lens); so a ccrc Aa button can only sit beside the frame's own.
  - **Recommended:** keep the frame's own Aa only; the one bar carries Quick jump and Contents (and Outline on a plan), which leaves the title about 280 px at 412 px wide (236 on a plan). Task 7 records whether Aa's box overlaps a long title's first line at 412 px (`aaOverTitle`), for you to see.
  - Alternative: an Aa button on ccrc's bar too (one more 44 px tool, `settings` already in `ReaderCommand`; a one-line change to `oneBarTools`), with the frame's own Aa still drawn: two buttons for one menu.
- **Q3. Where Share, Export and View on GitHub go on the one bar.** The mockup you picked put them in a ⋯ menu (View on GitHub, Share, Export, Document details) and opened the details by tapping the title.
  - **Recommended:** no ⋯; the title opens the details panel, which then holds the crumbs, the truth line and the full header's actions line (View on GitHub, Share, Export, Open committed version), in §4.5's order and with their words. Why: the title gets the row's room, one disclosure serves both, and no new menu component with its own focus and dismissal rules is built (refinement (k)). Share and Export are two taps either way.
  - Alternative: the mockup's ⋯ menu beside the tools: one more 44 px control on the row (the title down to about 236 px at 412 px wide, 192 on a plan), a menu component, and its own keyboard and dismissal tests.

### Waiting on you
- No further answer to this plan's Q1-Q3 is needed. Task 9 writes the owed Settings-access amendment; exact-tip checks, amendment review and plan landing are coordinator work before dispatch.

### Later
- A lab profile that draws after `ready` (`ready-and-settle`, or a drawn signal of the library's own), required before claiming that mode's timing or a future draw flip; not required to ship the selected on-request outcome (refinement (d)).
- From the library's own Later: a report op for overlay state, so ccrc's tool buttons can carry `aria-expanded`; a running-head report; a "tools available" report, so the bar shows Contents and Outline only where the document has them; `'after-ready'` as the library's default at a major.
- Drawing a figure only when it scrolls into view, if a reading shows single figures over the stall budget (the lab's `draw on open:` reading names that case).
- Dedicated icons for the tools (vendored from lucide-static as the header wave did), if the shared `search` and `layout-list` glyphs read as the palette and the fleet.
- The one bar on tablets, or on listings, if wanted after use (one line in `readerChromeFor` or `headLayoutFor`, and its width cases).
- W8a's residue (W8b), and the RL-a, RL-b and header residue, for the waves that next edit those files.
- The operator's device check after rollout, and a lab run on the 1.1.0 build (library `6bcf14892e48`).
