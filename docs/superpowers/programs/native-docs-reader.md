# Program: native-docs-reader

Spec: `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` (approved 2026-10-01)
Plans: W1 `docs/superpowers/plans/2026-10-01-native-docs-reader-w1-ccd-reads-docs.md`; W2 `docs/superpowers/plans/2026-10-06-native-docs-reader-w2-grants-and-adapter.md`; W8a `docs/superpowers/plans/2026-10-31-native-docs-reader-w8a-reader-frame-core.md`; W5 Export `docs/superpowers/plans/2026-11-03-native-docs-reader-w5-part2-export.md`; W5h-b `docs/superpowers/plans/2026-11-03-native-docs-reader-w5h-b-measured-values.md`; first-load compression `docs/superpowers/plans/2026-11-03-native-docs-reader-first-load-compression.md`; phone header `docs/superpowers/plans/2026-11-03-native-docs-reader-phone-header.md`
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-canyon`   Workspace: a fresh child per wave

**What this program is.** ccrc gains its own session-gated Docs reader for each install's own project docs:
specs, plans, product-design and conventions. It replaces the operator's standalone, tailnet-only docs server
with nothing outside ccrc's auth. The content stays in each user's own repositories and is never bundled.
The fleet box reads docs through four narrow ccd verbs (W1). The server adapts them behind a capability
(W2) and serves session-gated routes (W3). The PWA renders docs, images and sandboxed mockups (W4-W6). W7
documents and releases it.

## Waves

The spec (§7.7) orders them W1 -> W2 -> W3 -> W5 -> W6 -> W7, with W1 -> W4 -> W5 in parallel.
Since 2026-10-15 (operator), W5 runs as part 1, then W5h and Share in parallel, then Export, then W5b (RD23). W5h runs as two runs, W5h-a and W5h-b, and Export waits for W5h-a and Share, not for W5h-b (coordinator, 2026-10-15).

| # | scope | PRs | state |
|---|---|---|---|
| 1 | ccd reads docs: `shared/docs.ts`, `docs-index`/`docs-tree`/`docs-show`/`docs-fetch` and the embedded helper, the doctor's `docs` check | #301 | **merged** 2026-10-06 (`f03d83304`). Executed in the coordinator's session (subagent-driven, 19 tasks, per-task reviews, a six-lens final review, one fix round), not as a run |
| 2 | grants and adapter: agent grants, `DOCS_CAP` and builders, runner budgets, `server/src/docs/{policy,ports,ccdsource}.ts`, the docs ring guard | #319 | **merged** 2026-10-09 (`5a6e5d3d7`). Run 315: review 317, then three fix rounds (two defects, then the one-reader scan), a merge of `main` after ccrc-history B1 landed, and closure review 343. Run 315 closed done |
| 3 | routes: `server/src/docs/{routes,hooks,lane,cache}.ts`, registration, dark rollout, R1/R2 | #339 | **merged** 2026-10-09 (`f4d75a741`). Run 342: review 361, one fix round, scoped re-review 364 clean. After the merge, the operator runs the dark rollout, fleet first, then R2 and R1 (§7.8). Both gate W5's merge |
| 4 | PWA foundation: markdown extraction, `RenderBoundary`, chat hardening (U3), `docs-sw` | #381 | **merged** 2026-10-13 (`baba5c1bc`). Run 367: review 408 (12 findings, one critical: the built worker chunk could not load in a browser worker), one fix round, scoped re-review 412 (8 minor, carried to W5). Nine deviations, 4768 to 4776; 4777 to 4783 unspent. Run 367 closed done after W5's run opened |
| 5 | Docs screen, plus Share and Export (see Decisions, 2026-10-06); plain, plus `<br>` as a line break in the docs profile (2026-10-12). Split into two runs (operator, 2026-10-13). Part 2 splits again, into Share and Export (operator, 2026-10-15) | #627 (part 1; superseded #402) | **part 1 (the Docs screen):** **merged** 2026-10-19 (`9b18fb0cd`) through #627, which landed run 413's work (#402, block 4917 to 4932) reconciled with `main` and through the merge gate (R2 and R1 pass, spec §7.8); #402 closed as superseded. Run 413 was ended on 2026-11-03: the console offered no way to abandon that one run, so the coordinator closed it as an abandon at the operator's request. It shipped with its current bounds and carries the crafted-input freeze (operator, 2026-10-15). **Part 2, Share:** planned after part 1's review, dispatched after part 1 merges, in parallel with W5h. Plan `docs/superpowers/plans/2026-11-02-native-docs-reader-w5-part2-share.md` (written and approved by the operator 2026-11-02). Dispatched 2026-11-02 as run 1350 (block 7767 to 7779; 7767 to 7774 defined, 7775 to 7779 unused). **Merged** 2026-11-03 (`5d48c8157`) through #2145, at head `1ff85fcb4`, after review runs 1356 and 1358 and one fix round; run 1350 closed done. **Part 2, Export:** dispatched after W5h-a and Share merge; it does not wait for W5h-b. Run 1368 opened 2026-11-03 (planned) to keep the programme active. Plan `docs/superpowers/plans/2026-11-03-native-docs-reader-w5-part2-export.md` (13 tasks; written and reviewed 2026-11-03, approved by the operator the same day with every recommendation). Merged in #2188 (`a3c319d44`); dispatched 2026-11-03 as run 1368 (block 7879 to 7894; 7879 to 7891 defined, 7892 to 7894 unused). **Merged** 2026-11-04 (`b55e96a75`) through #2237, at head `67636f01b`, after review runs 1401, 1405 and 1406 and two fix rounds; run 1368 closed done |
| 5h-a | highlighting off the main thread, the worker path: a separate highlight worker for chat, Docs pages, text leaves and Export; the store; the main-thread check of the worker's HTML; the measurement page; the new constants at provisional starting values. Part 1's bounds stay in force beside it (see Decisions, 2026-10-15) | — | after W5 part 1 merges, in parallel with Share and before Export. Its spec amendment goes first. Once it is deployed, the operator opens the measurement page once on the phone. Plan `docs/superpowers/plans/2026-11-02-native-docs-reader-w5h-a-highlight-worker.md` (written and approved by the operator 2026-11-02). Dispatched 2026-11-02 as run 1319 (block 7751 to 7766; 7751 to 7763 defined, 7764 to 7766 unused). **Merged** 2026-11-03 (`408d93806`) through #2161, at head `dcf2b9ecb`, after review runs 1364 and 1366 and one fix round; run 1319 closed done |
| 5h-b | the measured values, then, in a commit of its own, all of part 1's main-thread highlight bounds retire: the word, line and whitespace bounds, the per-grammar block caps for typescript/javascript and rust, and the scan and markdown page budgets, with their mutation rows re-pointed. The xml strip and the 64 KiB and 512 KiB caps stay | — | after the operator's phone measurement. Export and W7 do not wait for it; W8 does (amended 2026-10-15; W5h). R19 was measured on the operator's phone on 2026-11-03 and the retirement gate passes. Plan `docs/superpowers/plans/2026-11-03-native-docs-reader-w5h-b-measured-values.md` (5 tasks; written and reviewed 2026-11-03, approved by the operator on 2026-11-03 with every recommendation). Dispatched on 2026-11-04, after Export merged, as run 1412 (block 7927 to 7933) |
| 5b | parity, server half: sections `vision` and `promise`, per-doc history (`docs-log`), page key `at=<sha>` (rich-docs spec 2026-10-12) | — | after W5 (operator, 2026-10-13) |
| 6 | mockups | — | after W5 |
| 7 | docs and release | — | after W6 |
| 8 | the reader frame: the shared library `docserver` mounted in a sandboxed frame with a checked bridge, the plain pipeline as fallback (proposed, rich-docs spec 2026-10-12). It inherits W5h's highlight worker and rules on the colouring divergences W5h records (2026-10-15) | #2037 (W8a plan), #2061 (W8a) | proposed; after W5b, W6, W7, library v1 and W5h-b (amended 2026-10-15; W5h). Library v1 is met: `@synapsium-labs/docserver` 1.0.0 was released on 2026-10-31. Split by the operator on 2026-10-31: **W8a**, the frame core, now, beside W5h-a and Share (plan `docs/superpowers/plans/2026-10-31-native-docs-reader-w8a-reader-frame-core.md`, approved by the operator on 2026-11-01 and merged in #2037). **W8a accepted** on 2026-11-01 at `4d62121a7`: run 1315, PR #2061, review runs 1316, 1317 and 1318 with two fix rounds, block 7691 to 7707 all defined, landing through the merge queue. Its residue goes to W8b; **W8b**, the version menu and "changes since", after W5b; W7 last. **W8a is live:** the operator's phone check on 2026-11-03 opened a spec in the reader. Its follow-ups are in Decisions, 2026-11-03 (late): the first-load compression (approved by the operator on 2026-11-03; run 1400, block 7903 to 7905 all unused; **merged** 2026-11-04, `ffa9f0ab2`, through #2247), Mermaid drawn on open (ruled; needs a library change), a compact phone header (the operator picked option 1 now and option 2 with the library release; plan written), and a reader lab page (the operator: build it, as a wave of its own) |

## Decisions & deviations
- **2026-11-04 (later): compression accepted and merged (coordinator).**
  - **Round 2, review run 1414, at `5574f7c0b`.** No code defect. Two stale bullets in the plan's "Carried, not fixed" (rated important, plan text only) and three advisories, all fixed in a second round. One advisory amended the coordinator's earlier ruling: the q-value case now sends `br;q=0.5, gzip;q=1`, which reds both a negotiator that takes the first listed coding and one that ranks by its own order. A test pinning `emptyOutDir` on the real config was ruled out of the wave (Later, below).
  - **Round 3, review run 1417, at `a63a4f57c`, the last under the cap.** No critical or important finding. Its two minor items are carried (Carried constraints), because neither is a code defect and the cap is spent. Run 1400 was accepted at `a63a4f57c`.
  - **Landing.** The first queue attempt was removed by one browser case, W8a's "M8.B5 control", which waits a fixed 500 ms for a navigated child's hello. The queue group stacked on it carried the same change and passed both browser shards, so the coordinator read it as a timing flake and re-enqueued the PR unchanged. #2247 merged on 2026-11-04 (`ffa9f0ab2`); run 1400 closed done, with 7903 to 7905 unused.
  - **Later:** a test that pins `emptyOutDir` on the real `pwa/vite.config.ts`. Today the guarantee against a compressed shell copy rests on it, and every built-output test sets it itself.
- **2026-11-04 (morning): Export merged, W5h-b dispatched, compression's first review ruled (coordinator).**
  - **Export merged** on 2026-11-04 (`b55e96a75`) through #2237, at head `67636f01b`. The merge queue held it for over an hour behind two code-scanning threads on test files; the coordinator dismissed both as used in tests. Run 1368 closed done.
  - **W5h-b dispatched** as run 1412, with the block 7927 to 7933. 7927 and 7928 are refinements (b) and (c), the departures the operator approved on 2026-11-03; 7929 takes Export's residue (Carried constraints) as a scope addition.
  - **Compression, review run 1411 at `c6d8f2918`.** Minor items only, all ruled into one fix round:
    - F1: Brotli's text mode and size hint are tuning, not guards, so they take no mutation row. The results say so: on the case's fixtures the output with and without them was byte-identical.
    - F2: the server comment states @fastify/static's negotiation as it is, and two cases pin q-value order and a refused coding.
    - F3: the worker measured that, with pre-compressed copies on, @fastify/static 10.1.8 sends `index.html.br` or `sw.js.br` as Brotli for `/`, `/index.html`, the SPA fallback and `/sw.js` whenever such a copy exists. Asked as ask 302 and ruled build-side only, as the approved plan scopes it: no server change, and no test pins a shell copy being sent. The guarantee rests on the build's `assets/`-only copies and `emptyOutDir`; carried as a constraint.
    - F4: accepted. The release runner's Node floats on the open engines range, so a runner change can cut a prerelease that differs only in its copies, and every release carries about 4.2 MB more (1,870,694 B `.br` and 2,307,989 B `.gz`).
    - F5: the results' bookkeeping corrected.
    - The fix round ended at `5574f7c0b` with the PR's CI green. Round-2 review run 1414 reads it.
  - **Later:** pin the release runner's Node version (compression's F4).
- **2026-11-04: Export accepted after three review rounds; its last five minor items carried (coordinator).**
  - **Round 1, review run 1401, at `806224fbe`.** Two findings and four advisories, all fixed in one round:
    - Layer order: 7891's line had moved Tailwind's own `properties` layer from lowest to highest, which matters in Firefox 114 to 127. The line now declares `properties` first, and a built-output test holds the first name against the built entry sheet.
    - The stylesheet in the browser leg: the browser config turned every `.css?raw` import into an empty string, so the browser leg's export carried an empty `<style>`. A `css.include` was added, and the built file's style is asserted against the real stylesheet; recorded under 7887.
    - The four advisories: an aligned table in the hostile corpus; a worktree segment holding markup; Retry's tap floor; and a planted git-failure detail.
    - The reviewer also measured the build. The entry is 400 kB further under workbox's 2 MiB ceiling; the precache grows 314 KiB, mostly Export's lazy chunk; and the bytes before first paint are within one per cent.
  - **Round 2, review run 1405, at `22f8fd8d1`.** The reviewer's first reading skipped the held-out panel. The coordinator held the run open until the panel ran as written. The panel confirmed one item and six advisories, fixed in a second round: the planted worktree segment now holds a double quote as spec row M4.EX2 asks, dead checks are replaced, the link-order pin moves to the built shell, the layer census reads dotted and anonymous names, and the plan's text is corrected.
  - **Round 3, review run 1406, at `67636f01b`, the last under the cap.** The panel ran as written with 17 agents and confirmed nothing. Its five minor items are carried (see Carried constraints), because none is a code defect and the cap is spent. Run 1368 was accepted at `67636f01b`, and #2237 was enqueued bound to that head.
- **2026-11-03 (late night): the header pick, the reader lab, compression dispatched, Export's layer-order fix (operator, coordinator).**
  - **The phone header (operator, console item 11).** Option 1, one console row, now; option 2, one bar merged with the reader's own, later with the library release that carries Mermaid-on-open and the U+2028/2029 check. Plan `docs/superpowers/plans/2026-11-03-native-docs-reader-phone-header.md`: written, reviewed by three lenses with a refuter per finding (sixteen findings upheld and applied, none refuted), waiting for the operator's approval and Q1 to Q3. It is dispatched after Export merges, because both edit the Docs header.
    - Where the plan and the picked mockup differed, the coordinator followed the mockup: the row keeps its 1 px divider, and a stale or failed fetch shows the same attention-coloured dot.
  - **The reader lab (operator, console item 12).** "Build it": a wave of its own, not part of W8b, which stays after W5b. Its design and plan are being drafted; the design goes to the operator first, because the page needs a test-only server door that counts which lab requests carried the session.
  - **Compression dispatched.** Run 1400 opened after #2210 merged and went to a fresh child, with the block 7903 to 7905 for departures found while executing. Two live claims of other runs cover files it edits, each under a scoped agreement instead of a claim:
    - `pwa/vite.config.ts`, held by Export (claim 3329, this programme): separate hunks, agreed by the coordinator of both runs.
    - `README.md`, held by box settings W1 (claim 3365, another programme): one sentence in the Caddyfile bullet, agreed by that holder and its coordinator; a three-way merge measured clean.
  - **Export, run 1368 (coordinator rulings).**
    - The PR's full CI run was red in the browser leg only. The cause, measured by the worker: Export's lazy builder chunk made the build emit a shared chunk whose stylesheet loads before `index.css` and opens `@layer components` first, so the reset's rules beat every `@ccrc/ui` component rule, in the shipped build too. Ruled: `index.html`'s pre-paint `<style>` declares the layer order first, pinned against `theme.css`'s own statement, with a mutation row; numbered 7891. The `build.cssCodeSplit` route was measured not to work.
    - The worker had measured the candidate fixes in copies of the branch outside its workspace, which the low-disk rule forbids; it removed them and measures only inside its workspace from then on.
- **2026-11-03 (night): the operator approves the W5h-b and compression plans; Export's run rulings (operator, coordinator).**
  - **Approval (operator).** Asked on the console's Waiting-on-you list as item 10, answered "Approve both with every recommendation".
    - W5h-b: Q1, `HIGHLIGHT_PAGE_WORKER_MS` 12 000 ms; Q2, `MD_HIGHLIGHT_MAX_HTML_CHARS` 1 048 576, departing from §4.9's product rule (refinement (c)); Q3, `HIGHLIGHT_PAGE_MAX_TIMEOUTS` stays 2, departing from §4.9's "smallest count no real page reaches" (refinement (b)); Q4, the per-job latency is a later follow-up. The departures stay plan-only and are numbered at W5h-b's run opening. W5h-b is still dispatched only after Export merges.
    - Compression: approved; Q1, copies for the hashed `assets/` files only. Its run opens now, beside Export: both edit `pwa/vite.config.ts` (Export's 7887 entry inside `server:`, compression's imports, function and plugin entry), in hunks that merge cleanly in either order, and compression's one README sentence merges cleanly with box settings W1's README edits (both measured by three-way merge). The coordinator states the scoped agreements in the brief.
  - **The operator's open points are on the console (coordinator).** The coordinator's questions are raised as items too (10, this approval; 11, the phone header; 12, the reader lab), and the programme's Goals pin the spec.
  - **Export, run 1368 (coordinator rulings).**
    - Mutation rows measured above their prediction are accepted as measured and restated in the plan's results with the extra tests named; a row below its prediction stays a stop-and-ask.
    - Departures found while executing: 7888, DocsScreen's nested `publish` also forwards to the outer one (production has no outer publisher); 7889, a second control-census entry for the export links; 7890, the Export sheet's key carries an `export` prefix (the plan's key equalled Share's).
    - The ruling numbered 7887 extended to `pwa/vitest.browser.config.ts`, a standalone config that does not inherit `vite.config.ts`: the same `server.fs.allow` entry, and the browser test imports the real stylesheet module instead of a mock that copied its stripping rule.
    - PR #2237 opened at `5fcc4268a`, all 103 mutation rows red at the end state; waiting for its CI before the wave-done.
- **2026-11-03 (late): the phone check, R19, Export dispatched, and two follow-up plans (operator, coordinator).**
  - **The W8a phone check (operator).** On a Pixel 10 Pro XL in Chrome on Android 17, a spec with six Mermaid figures opened in the reader. The first open was slow, the figures drew quickly on tap, and the header took too much room. The phone's engine is Chromium, the engine every wall was measured on.
  - **Ruling: Mermaid draws on open (operator).** This replaces W8a's draw-on-tap default (the rich-docs spec's `reader-mermaid-on-tap`).
    - The library's `'auto'` mode holds `ready` until every figure is drawn, and W8a's watchdog budget has no Mermaid allowance, so flipping the mode alone would send figure-heavy docs to the plain view.
    - The coordinator's route: a library change that draws after `ready` and accepts the Mermaid text after mount, batched with the U+2028/2029 copy check into the held library release, then a ccrc wave that takes it. That wave amends the rich-docs spec's draw-on-tap sentences.
  - **The slow first open, measured on the live console.** No static asset was sent with a content encoding: on a doc with figures, about 6.4 MB (the main bundle about 2 MB, the reader chunks about 0.75 MB, the Mermaid chunk 3.7 MB) before the text. The bridge also waits for the Mermaid chunk before it mounts the frame, in either draw mode.
    - Plan `docs/superpowers/plans/2026-11-03-native-docs-reader-first-load-compression.md`: the build writes `.br` and `.gz` beside each hashed asset with `node:zlib`, and the server sends them through `@fastify/static`'s `preCompressed`. No Caddy change, no runtime compression, no new dependency. Reviewed by three lenses and a refuter per finding; four findings upheld and applied.
    - Ruling (coordinator): Brotli quality 11 while the step stays within 45 s and the build within 120 s (the built-output tests' child timeout is 170 s); otherwise quality 9, recorded.
    - Showing the text before the Mermaid chunk arrives is the library change above.
  - **The phone header.** About 341 px sit above a doc's title on that phone. Three static mockups are on the branch `brainstorm/docs-phone-header`: one console row (133 px, ccrc only), one bar merged with the reader's own (81 px, needs library hooks) and a header that scrolls away (no change at open). The coordinator recommends the first now and the second later. The operator picks; the work follows Export, which edits the same header.
  - **R19 (operator).** The measurement page ran on the same phone over 1 381 docs and 41 871 blocks. The slowest real block took 143.7 ms warm and the largest cold 96.1 ms, against the operator's 2 s bound, so the retirement gate passes. The main thread's longest frame gap stayed about 17 ms while crafted blocks ran to the 750 ms deadline. The largest real page took 9.5 s to colour, which is per-block latency, not worker time.
    - Plan `docs/superpowers/plans/2026-11-03-native-docs-reader-w5h-b-measured-values.md` sets the seven values from it and retires part 1's bounds; reviewed by three lenses and a refuter per finding, nine findings upheld and applied, no value changed.
    - Ruling (coordinator): W5h-b is dispatched only after Export merges, because Export's approved code reads what W5h-b deletes.
  - **Export dispatched.** Run 1368 went to a fresh child with the block 7879 to 7894; the first eight go to (a), (b), (c), (e), (f), (g), (h) and (w). Claim 3315 (another programme's) held `contrast.test.ts`; a scoped agreement with its holder and its coordinator lets both proceed in separate hunks.
    - Ruling (coordinator), Task 2: `@ccrc/ui`'s `?raw` stylesheets need one line in `pwa/vite.config.ts`, `server.fs.allow`, because pwa has no workspace root above it. The line goes in its own commit and takes the first reserve number, 7887.
  - **The reader lab.** A static mockup of a console page that would run E17 and E18 on the phone is on the branch `brainstorm/reader-lab`. The operator has not ruled on it.
- **2026-11-03 (evening): the operator approves the Export plan with every recommendation; run 413 ends (operator, coordinator).**
  - **Answers.**
    - Q1, A: on a page the reader frame shows, the button reads "Export (plain view)", and its tap switches that page to the plain view and exports it (refinement (a)).
    - Q2: no build version in the provenance for now; the `generator` meta carries the format's version.
    - Q3: the export keeps the exporter's palette, any of the twelve.
    - Q4: on an image page whose image failed to load, Export shows disabled, reading "Image not loaded".
    - Q5: one `exports` line in `ui/package.json` for prose.css.
    - Q6: one run.
  - **The departures stay plan-only.** The approval asked for no spec amendment, so (a), (b), (c), (e), (f), (g), (h) and (w) are numbered at the run's opening and recorded in the plan's Deviations found, not written into the spec.
  - **Run 413 ends.** The console offered no way to abandon that one run. At the operator's request, the coordinator closed it through its own close route as an abandon (state failed): its work landed through #627 on 2026-10-19, and #402 itself never merged. The server queued the child's reclaim, which pins every commit before it removes anything. Run 1368 keeps the programme open.
  - **Test timing (coordinator, #2192, merged as `eba3f63cb`).** Two docs-reader test faults dequeued or reddened other programmes' pull requests:
    - the `docs-scans` clauses W8a and W5 Share copy the whole of `pwa/src` per planted case and passed vitest's 5 s default on a loaded runner; they now take the 30 s bound clause W5h-a has;
    - five cases released a held in-thread highlighter after waiting on the DOM, before the block's request had been posted, so a late request was held for good; they now wait for the request first.
- **2026-11-03 (later): Export is planned, waiting for the operator's approval (coordinator).**
  - **The plan.** `docs/superpowers/plans/2026-11-03-native-docs-reader-w5-part2-export.md`: 13 tasks (11 build tasks, a held-out review, a close), written at `main` `ee7a9c44f`. Rev 1 was drafted just after W5h-a merged.
  - **Reviewed.** Three Opus lenses (spec, grounding, execution), with a Sonnet refuter per finding, upheld 12 findings, three of them important:
    - the reader-path option understated its cost;
    - one expected line number was wrong;
    - one predicted red was wrong.
    A scoped re-check confirmed the fixes and found three more, one important: a build branch that would have broken five planted scan cases. All are fixed. The author also re-opened one refuted finding and planned it: Export's wait ending at the worker-time ceiling.
  - **Departures.** Eight departures, refinements (a), (b), (c), (e), (f), (g), (h) and (w), so the run needs a block of at least 14 numbers at its opening. The largest is (a): on a leaf the reader frame shows, Export switches that page to the plain view and saves it. That costs one parse, one highlight pass and one docs read per image, against §4.17's "no docs request, no re-parse, no highlighting".
  - **Questions for the operator (Q1 to Q6)** are in the plan's "Waiting on you", each with a recommendation:
    - the reader path;
    - the build version;
    - the palette;
    - a failed raster image;
    - prose.css's subpath;
    - one run or two.

- **2026-11-03: W5h-a is accepted and merged, and Export's run is opened (coordinator).**
  - **Review round 1 (run 1364, tip `518e42a14`).** Four important findings and seven advisory notes. The important ones:
    - a page of repeated identical blocks bypassed the page HTML ceiling, because each key was counted once while each copy inserted its HTML;
    - a chat store kept subscriber and listener rows for keys that no block referenced;
    - the Docs store moved into `DocTree` without a number;
    - `detach()`'s clock stop was pinned by no test.
    Fix round 1 fixed all eleven items: D-7762 (the ceilings count each drawn copy, one job per key), D-7763 (the store's move stands), and the rest without numbers.
  - **Review round 2 (run 1366, tip `dcf2b9ecb`).** The code was clean: every round-1 item was verified, and all 16 new mutation rows were measured red at their recorded counts. The two plan-text findings are fixed in this ledger PR rather than by a third push and review. Refinement (j) is marked a departure (D-7762), and D-7762 names the spec sentences it departs from and its consequence for Export. Spec §4.10, §4.4 and §1 are amended in place for D-7762 and D-7763. Two minor test gaps are carried to W5h-b.
  - **CI on the PR.** One load timeout (`ccrc-update-fetch`) was re-run by the coordinator. Two closed censuses in other programmes' suites went red on this wave's words. The update move's `'detach'` census got an exemption, D-7761, narrowed to `markdownRunner.ts`'s `abortRunning` lines. Delegation wave 3's `retain` census was met by renaming the test seam to `heldKeys`. Both were misses of the wave's own server runs.
  - **Ruling: a review child may install packages.** A fresh review workspace has no `node_modules`. It may run `npm ci` in its own `server/`, `pwa/`, `agent/` and `ui/`, and nowhere else, because the workspace is reclaimed when the review run closes. Measured 2026-11-03: 91 GB free, and about 0.5 GB per install.
  - **Export's run (1368, planned)** is opened so that the programme stays active whatever happens to run 413. Export's plan inputs:
    - D-7762 (read `copySkip` for each drawn copy);
    - D-7763 (a fallback body publishes no store);
    - D-7755 (the `publish` slot's holder);
    - M4.SH3's and M4.SH8's Export halves;
    - Share's carried notice after a double tap and a cancelled native sheet.
- **2026-11-03: Share is accepted and merged (coordinator).**
  - **Review round 2 (run 1358, tip `1ff85fcb4`).** All nine items from round 1 were done, and each was measured (the two `canShare` rows red through their own tests; W5S-T4-M5 reds 4 of 101). Every suite was green at the tip, and nothing outside round 1's items changed. The six findings were in the plan's text, not in shipped behaviour. The reviewer refuted its findings by measuring them rather than with Sonnet refuters; the coordinator accepted that, because every finding was taken.
  - **Landed as reviewed.** #2145 merged through the queue as `5d48c8157`, from the exact head both reviews read. The plan-text findings are fixed in this ledger PR instead of a third push and review:
    - D-7774's rationale now says that the key closes the sheet on a page, commit or opened-pin change, and that everything else the target reads updates the open sheet in place;
    - row W5S-T5-M5 is restated at 4 failed at the end state;
    - rows W5S-T9-M4 and M5 are in the table's form;
    - the fix-round re-run line names `deviation-refs` and `dtbd`;
    - Task 5's Decision (2) carries a "superseded in fix round 1" note.
  - **Ruling: W5S-T9-M5's `Boolean(...)` mutation stands.** It reds the same single test as dropping `=== true`.
  - **Carried, from Share:** a double tap followed by a cancelled native sheet leaves tap 2's "Sharing did not finish" notice standing. The notice is true, and Copy link still works. It goes to Export's run or a later polish.
- **2026-11-02 (later): both waves are dispatched, the copy check gains U+2028 and U+2029, and the rulings made while the waves run (operator, coordinator).**
  - **The copy check (operator).** U+2028 and U+2029 join the copy check, with the four classes of the entry below. The copy check flags them, and the library's link classifier refuses them in an href. This needs one more library change, which ships in the same batched release. Then ccrc moves its pin, and spec §4.4's copy-check sentence lists the new classes.
  - **Dispatch (coordinator).** #2124 merged as `9c484ef45`.
    - W5h-a: run 1319, block 7751 to 7766. The first six numbers go to its refinements (a), (b), (e), (f), (h) and (q), in that order.
    - Share: run 1350, opened as wave 10, block 7767 to 7779. The first six go to (a), (b), (c), (e), (f) and (i).
  - **Ruling (W5h-a, deviation 7757): part 1's test cases over the HTML cap.**
    - The problem: Task 6's migrated suites hold 64 KiB blocks whose highlighted HTML (313 090 to 1 719 411 characters) exceeds the 262 144 cap the operator kept.
    - The ruling: those cases assert part 1's decision (the block is admitted and requested) and the outcome that ships (plain, "not highlighted (output too large)"), never an exact HTML length. Each suite keeps one coloured case under the cap.
    - Rejected: a test-only cap override, and shrunken inputs.
    - Cost if wrong: W5h-b revisits these cases when it sets the measured cap.
  - **Ruling (W5h-a, deviation 7758): the store's class check admits highlight.js's own scope classes only.** Task 5's review tightened it from "a first `hljs-` token, then anything". The worker names a test proving that real highlight.js 11.12 output from all 15 grammars passes, the multi-class sub-scopes included, so that W8's version bump goes red instead of silently turning blocks plain.
  - **Rulings: mutation rows measured above the plan's prediction.** These are W5h-a's T3-M6, T7-M1 and T7-M4, and Share's T2-M1, T5-M1 and T5-M4. Each is restated at its measured count. Every extra red is the same guard, or a later fix-wave test aimed at the mutated line. They correct predictions, so they take no number.
  - **Share's review (run 1356, tip `ba06f4cdd`).**
    - One important finding: no test pinned `webShareUsable`'s arm where `canShare` answers true. Measured: with that arm replaced by `return false`, 343 tests stayed green.
    - Sent back for one fix round: two cases with their mutation rows; deviation 7774 (the open sheet's target is recomputed while the sheet is open, against refinement (n)'s text); and five minor fixes.
    - One advisory is carried: a double tap followed by a cancelled native sheet leaves tap 2's notice standing. The notice is true, and Copy link still works.
  - **Ruling: deviation 7773 amends the spec in place.** Share's Task 9 review found that after a same-blob re-list, a file slot that had settled with no answer it can show kept its old pin, so Share read "Updating to" until Retry. Such a slot is ready at `pinFor`'s pin, as a failed raster image settles Share (the operator's approval of 2026-11-02). §4.16's "When Share is not offered" and M4.EX12 now say so, marked "(amended 2026-11-02; Share, deviation 7773)". Cost if wrong: Share links the tree's commit for a leaf that showed nothing, which is what View on GitHub already does.
  - **Shared files and claims.** The claim service allows one holder per path, so the briefs' "take your claims" could not hold for both waves on a shared file.
    - W5h-a holds the claims on `DocsLeaf.tsx`, `DocsScreen.tsx`, `docs-screen.test.tsx` and `docs-scans.test.ts`. Share edited those files inside its plan's hunks, under the briefs' written leave.
    - The coordinator also gave the desktop-polish programme written leave for one-line additions under W5h-a's claim: the architecture spec's C5 cell, the end of the route table, the ladder after `docs`, and their tests. Each is placed apart from W5h-a's edits.
    - Lesson for the next parallel briefs: name which wave holds each shared claim, and say that the other edits under written leave.
- **2026-11-02: W5h-a and Share are planned, and the copy check's extension waits for one batched library release (operator, coordinator).**
  - **The copy check (operator).** Answering W8a's open question (the entry below), the operator ruled that the copy check also flags U+200E, U+200F, U+061C and the tag characters U+E0000-E007F. The library carries it (Synapsium-Labs/docserver#78, its ledger's C103); its link classifier refuses the same characters in an href. The operator then held the release: the remaining items are built first, and the library's changes ship in one release. ccrc then moves its pin, and spec §4.4's copy-check sentence lists the four new classes. Until then the reader flags the spec's §4.4 set. U+2028 and U+2029 join the set as well (operator, later on 2026-11-02; the entry above).
  - **The plans (coordinator).** W5h-a: `docs/superpowers/plans/2026-11-02-native-docs-reader-w5h-a-highlight-worker.md` (11 tasks). Share: `docs/superpowers/plans/2026-11-02-native-docs-reader-w5-part2-share.md` (10 tasks). Both were written at `main` `02622053c` from the spec, re-grounding earlier drafts of 2026-10-15 to 10-17 that predate #627 and #2061. Each was read by three Opus lenses with a Sonnet refuter per lens, fixed, and re-read (Share: 11 findings; W5h-a: 21; none critical). Their departures are numbered when their runs open.
  - **Ruling: M4.SH3's and M4.SH8's Export halves move to Export.** Share cannot test an Export control before Export exists. §7.7's W5 Share and W5 Export rows, and the Export bullet in the next-wave brief below, now say so (amended 2026-11-02). Cost if wrong: none; Export's plan carries them.
  - **Ruling: R19's item 8 runs over three fixed settle cadences** (50, 100 and 250 ms) instead of "chat's own": `main` has no fixed chat settle cadence, since chat re-renders as stream frames arrive. W5h-b sets `HIGHLIGHT_STREAM_DEBOUNCE_MS` from that table. A departure, the W5h-a plan's refinement (q). Cost if wrong: W5h-b picks a debounce for a cadence chat does not have; the page can be re-run.
  - **Approved (operator, 2026-11-02).** The operator approved both plans and took every recommendation. Share: a raster image that fails to load settles Share at its pin; a leaf that opens nothing links at the tree's commit; the six departing refinements are written into the spec in place, each marked "(amended 2026-11-02; Share)". W5h-a: the tool cards' code and diff wells move onto the worker; dense JSON or YAML stays plain until W5h-b, with the provisional per-block HTML cap kept at 262 144; the longest wait the operator accepts for one block's colours, R19's retirement bound, is 2 s; the measurement page is Settings › Measure highlighting; one run. W5h-a's departures stay plan-only, numbered at run open.
  - **Overlap.** The two waves share `DocsLeaf.tsx`, `DocsScreen.tsx`, `docs.css`, `docs-scans.test.ts`, `docs-screen.test.tsx` and the census registries, in different hunks. They dispatch in parallel; the second to merge takes `main` and re-measures.
  - **Carried line closed.** "`GithubTarget` cannot express `resolveDocRef`'s `repo` kind" was closed by W5 part 1 (#627): `shared/docs.ts#GithubTarget` has `repo` and `root`, pinned by M3.16-M3.18.
- **2026-11-01: W8a is accepted after three review rounds, and its residue goes to W8b (coordinator).**
  - **What shipped.** Run 1315 shipped Tasks 1-12 as PR #2061.
  - **Round 1.** Review run 1316 read tip `9c9435ca9` and found 6 important findings and 8 advisory notes. Fix round 1:
    - ledgered three departures: the supply-chain deadlines Task 11 added, the reader's theme following the palette's mode, and the copy-failed sheet;
    - re-measured a mutation row that went red on a ReferenceError instead of on its own assertion;
    - bounded the Mermaid asset wait in `mountReader` by the reader's watchdog.
  - **Round 2.** Review run 1317 read tip `bad17ff56` and found 2 important findings. Fix round 2:
    - decodes a percent-encoded fragment before it seeds the frame;
    - measures the shell's `frame-src 'none'` wall in Chrome, with Chrome's local-network checks off;
    - narrows M7.9's specifier exception to import positions;
    - re-measured the whole mutation table at one tip (115 rows, all red).
  - **Round 3.** Review run 1318 read tip `4d62121a7` and found 5 important findings and 13 advisory notes, none of them on the walls or the supply chain. The review cap is three rounds, so the coordinator ruled on round 3 without a fourth round: all five are narrow, and they go to W8b (Carried constraints, "W8a residue").
  - **Why accept now.** Every wall the spec lists is measured. The full suite and the browser leg are green on the exact tip. Each round-3 finding is either a test gap or a narrow case the user can see, and in those cases the plain view still works.
  - **Cost if wrong.** Until W8b lands, a same-page link spelled with its file name does not scroll the reader, and a heading deep link is lost when the frame falls back after it has mounted.
  - **Rulings on round 1.**
    - F1, F2 and A2 were ledgered as deviations 7704, 7705 and 7707.
    - F4 was fixed as deviation 7706: the Mermaid wait ends at `readerWatchdogMs(bytes)`, and no new number is declared.
    - F3 was fixed.
    - F5 was carried: the copy check flags exactly the spec's §4.4 set, which is the library's set.
    - F6 was accepted as the plan's disclosed ring bend, for W6.
  - **Rulings on round 2.** Both findings were fixed without a number. A1 and A7 were carried.
  - **Deviations.** Block 7691 to 7707. Every number is defined in the W8a plan's `## Deviations found`.
  - **Operator question (open).** Should the copy check also flag U+200E, U+200F, U+061C and the tag characters U+E0000-E007F? That would change spec §4.4 and the library, in a 1.0.x release. Until then, W8a ships the spec's set.
  - **CI note.** The `browser (pwa)` job took 18 min 55 s of its 20-minute limit on one run, and 15 min 50 s on the final run. If the merge queue ever times it out, the fix is a CI change of its own, not part of W8a.
- **2026-10-31: the W8 split and W8a's defaults (operator).** Asked six questions about the coordinator's proposal (the entry below), the operator answered "defaults":
  - **(1) Order.** W8 splits. W8a, the frame core, runs now, in parallel with W5h-a and Share. W8b (G5, G6's version menu, `at=<sha>`) follows W5b. W7 moves last, so the README is written once.
  - **(2) Frame code.** The library's own `./host` (`mountDocFrame`) is used, unless the plan finds it conflicts with ccrc's architecture rules. The W8a plan found no conflict: it mounts through one ccrc adapter, `docs/reader/bridge.ts`, and records the spec rows that this amends.
  - **(3) Images.** W8a carries the images the plain view already shows. Mockups and the asset planner stay in W6.
  - **(4) Mermaid.** It is inlined only for docs whose fences pass the gate, and drawn on tap (the library's on-request mode). Auto-draw may follow once the operator has measured on the phone.
  - **(5) Colouring.** The frame's colouring (the library's `render()`) may differ from the plain fallback's for now.
  - **(6) Done.** "Integrated" means W8a is live in ccrc. Retiring the standalone docs server is a separate, later gate (rich-docs spec §9).
  - Why: the library is released, and the frame needs only what is on `main`. Cost if wrong: W8b and the retirement gate still wait for W5b, so a wrong order costs one re-plan, not a rewrite.
  - The rich-docs spec is amended in place by the W8a plan's PR (marked "amended 2026-10-31"); the departures get their numbers from the allocator when W8a's run opens.
- **2026-10-31: the library is released; W5 part 1's landing recorded; the W8 order goes to the operator (coordinator).**
  - What: `@synapsium-labs/docserver` 1.0.0 is published on npm from a signed tag, with provenance, so W8's "library v1" prerequisite is met. W5 part 1 merged on 2026-10-19 through #627 (`9b18fb0cd`); the waves table said otherwise until now. The coordinator proposes splitting W8: W8a, the frame core (the exact pin, the render job in W4's parse worker, `ReaderFrame` with the hash-only `READER_CSP`, the bridge without `changes` and `version`, the plain pipeline as fallback), to run in parallel with W5h-a and Share; W8b, the version menu and "changes since", after W5b; and W7 last, so the README is written once. The proposal amends the rich-docs spec's agreed order (RD24, the W8 row, Figure 3), not a ruling of the operator's, and W8a's plan comes to the operator for review like every wave's.
  - Why: as written, seven waves stand between the released library and its first use in ccrc, and W5h-b waits on a phone measurement. The frame needs only what is on `main` now (`copyText`, W4's parse worker, part 1's screen).
  - Cost if wrong: W8a and W6 both touch the shell's frame policy, so one of them must own the shell meta (`frame-src 'none'`), and M8.2 keeps a mockup widening out of `READER_CSP`.
- **2026-10-15: highlighting moves off the main thread in a wave of its own, W5h, and W5 part 2 splits (operator).** Five rulings. Each says what was decided, why, and what it costs if it is wrong.
  - **(1) Part 1 ships with its current bounds.**
    - What: W5 part 1 (#402) merges with the word, line and whitespace bounds, the per-grammar block caps for typescript/javascript and rust, the scan and markdown page budgets, and the xml subLanguage strip. It carries the crafted-input freeze: a crafted code block that passes those bounds can still hold the main thread while it is coloured. Part 1's own residual note (on `DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS` in `lib/markdownLimits.ts`) measures the crafted page the coordinator accepted at about 3.2 to 4.4 s, and the shapes it lists as past every bound, for a Docs page, at about 9 to 11 s, 10.6 s on the worst combined page found, and for one chat block at about 4.5 s. So the freeze this ruling accepts is seconds, at least 10 s on a crafted page. Then a dedicated wave, W5h, moves highlighting off the main thread.
    - Why: the bounds are tuned shape by shape, and four reviews found shapes that passed them. More tuning would not close the class. Taking `highlight.js` off the main thread does.
    - Cost if wrong: until W5h lands, a crafted document or chat message can freeze the console for seconds while it renders.
  - **(2) W5h is the design the review recommended, as recommended.** The review is the coordinator's design review of 2026-10-15, which compared three designs; the spec carries the full design and graft list itself.
    - What: a separate highlight worker, with two singletons (`docsHighlighter` and `chatHighlighter`) in a second worker chunk. One block per job, each with its own deadline; an overrun terminates the worker and leaves only that block plain. A content-keyed highlight store per page, text leaf or chat message, which `CodeBlock` reads. A plain first frame on every code block, chat included. No main-thread fallback: with no Worker, code is plain. Whole-block colouring stays the policy, and a line-by-line retry under the library's C24 rule runs only for a block that timed out or hit the HTML cap. `highlight.js` leaves the main bundle. The one `dangerouslySetInnerHTML` stays in `lib/markdown.tsx`'s code component, behind a strict linear main-thread check of the worker's HTML. Export reads the store by peek only, waits (bounded by the page ceilings), and says in its provenance when colouring was partial or dropped.
    - Also every graft the review listed: the worker path lands with part 1's bounds still in force, and the old bounds go later (ruling 3); three requests to the library programme ((a) a public `./highlight` export, (b) a `highlight: false` render option, (c) the stock xml `<script>`/`<style>` cost under C24); a scan that Export's import closure holds neither the highlight worker nor `highlight.js`; a private `highlight.js` instance in the worker, pinned to call no `addPlugin`, `configure` or `debugMode`; a content cache inside the worker; a ready handshake, so a worker's boot never counts against the first block's deadline; a detach abort for the highlighter only, with the parse runner's behaviour pinned unchanged; and per-page ceilings on worker time and timeout count.
    - Why: of the three designs reviewed, only this one closes the freeze class by construction, because `highlight.js` is not in the main thread's import closure at all. A highlight overrun never kills a parse or turns a page plain. Whole-block colouring keeps today's colouring and the chat goldens byte for byte. C24 as the main policy would have lost colouring across lines on 59% of real fences and left 672 fences plain instead of 3, as measured by the coordinator's design review on 2026-10-15, at W5 part 1's head.
    - Cost if wrong: a plain first frame on every code block, colouring that depends on the device and its load, a worker respawn after each overrun, no colouring at all where there is no Worker, and a wait before Export.
  - **(3) All of part 1's main-thread highlight bounds retire later, in a commit of their own.**
    - What: once the worker path is green and a phone measurement shows the real corpus (21 651 blocks) inside the block deadline, all of part 1's main-thread highlight bounds are deleted in a commit of their own, with their mutation rows re-pointed: the word, line and whitespace bounds, the per-grammar block caps for typescript/javascript and rust, and the scan and markdown page budgets. The xml strip, the 64 KiB block cap (`MD_HIGHLIGHT_BLOCK_MAX_CHARS`) and the 512 KiB page cap (`DOCS_HIGHLIGHT_PAGE_MAX_CHARS`) stay, re-argued as bounds on the input that crosses the worker boundary. Which run carries the retirement, W5h-b, is the coordinator's ruling (below).
    - Why: once a deadline bounds the time off the main thread, the caps protect nothing, and they leave real code uncoloured. Deleting them only after the new path is green and measured means a fault in that path never leaves code unbounded.
    - Cost if wrong: retired too early, a fault in the worker path has no fallback bound; kept too long, real code stays uncoloured for no gain.
  - **(4) The deadline and ceiling values are measured on the operator's phone.**
    - What: the block deadline, the boot budget, the page ceilings and the HTML caps are measured through a measurement page behind the session gate, which the operator opens once. The design's figures (750 ms per block, 3 s of worker time and 2 timeouts per page, a per-block HTML cap of 4 times the 64 KiB block cap, 262 144 characters) are starting points to measure, not values. W5h-a's plan picks the starting points for the boot budget, the page HTML cap and the streaming debounce; the provisional page HTML cap must admit the eight 60 000-character blocks of the page-budget row (M4.H2).
    - Why: every bound so far was measured on desktop or server CPUs, and the reader is a phone.
    - Cost if wrong: a deadline set too low leaves ordinary code plain on the phone; set too high, a hostile page holds the highlight worker longer, though never the main thread.
  - **(5) W5 part 2 splits.**
    - What: Share runs in parallel with W5h, and only Export waits for W5h. The coordinator narrowed that wait to W5h-a (below). The order is part 1, then W5h and Share in parallel, then Export, then W5b (RD23).
    - Why: Share sends a GitHub permalink and renders no body, so it never touches highlighting. Export renders the page's code, so it must read W5h's store rather than call `highlight.js` again on the main thread.
    - Cost if wrong: an Export built before W5h would bring the freeze back on the Export tap. Where Share and W5h touch the same files, the second to merge takes `main` and re-measures.
  - **Coordinator rulings (2026-10-15), on the open points the review's drafters left:**
    - The main-thread check of the worker's HTML accepts exactly: `<span class="hljs-…">` with highlight.js scope classes; `<span class="language-NAME">`, where NAME is a registered grammar name or alias (highlight.js 11.11.1 wraps a subLanguage region this way, as `markdown` does for `xml` and `dockerfile` for `bash`); a balanced `</span>`; and text using highlight.js's five entities. Anything else leaves the block plain.
    - W5h is two run rows. W5h-a ships the worker path, the store, the check, the measurement page and the constants at provisional starting values, with part 1's bounds still in force; Export waits only for W5h-a. After W5h-a is deployed, the operator runs the phone measurement. W5h-b then sets the measured values and retires part 1's bounds in its own PR, with the mutation rows re-pointed. The measurement page stays shipped.
    - A chat message's store applies the per-block HTML cap, the timeout count and the worker-time ceiling, per message. The page input and page HTML caps apply to Docs only: chat has no page budget today, and gains none.
    - Export's provenance counts a block the line-by-line retry coloured as coloured, does not count a block with no registered grammar, and puts the check's structural refusals and the worker's failures in one `failed` class; the check's two length re-checks count as output too large and past a page ceiling.
    - No highlight.js bump in W5h: the move from 11.11.1 to the library's 11.12.0 stays W8's to rule on.
    - Mutation rows: M4.H3 to M4.H23 and M7.11 to M7.12 in the spec's §7.10, M4.C4 and M4.C5, and M4.EX17 and M4.EX18 in its §4.15. The spec's phone measurement is named R19 (§7.8), after its §2 risk list, where R4 is already taken.
  - **Where it is written.** W5h's amendment is written in place in the 2026-10-01 spec. The rich-docs spec cross-refers to it in A6, A22 and the W8 row, records the three divergences W8 must rule on (colouring policy, `highlight.js` 11.11.1 against the library's 11.12.0, and the grammar sets), and lists requests (a) to (c) in its §8. It also edits, each marked (amended 2026-10-15; W5h): its §8 order, Figure 3, the W5 row and the W5h-a and W5h-b rows; RD33 and the sentence that opens its §10; its "Later" list; A2a, A2b and M9.14 (the third worker file M5.16 admits); its §1.4 terms "Highlight worker" and "C24"; its §3.4 Highlighting row and §4.6 fallback bullet; its §7 intro (R19 beside R1-R3); its W4 row and "What stays unchanged" (W5h's amendments of M4.M1 and M4.P10, and M4.H1 re-proved); its "In short"; and its "Where things stand". No deviation number is written yet: W5h's departures are issued by the allocator.
- **2026-10-13: W5 is split, and three more rulings (operator).**
  - W5 runs as two sequential runs, each with its own plan, PR and review:
    - Part 1 is the Docs screen (14 tasks, run 413). It merges and rolls out on the dev channel with no Share or Export.
    - Part 2 is Share and Export, planned after part 1's review.
    - W5b follows part 2.
  - W4's C-1 is accepted as is: a crafted chat message of 4 KiB or less, nested by indentation, costs up to about 0.67 s of main-thread parse.
  - The new `browser (pwa)` leg is required by `full-suite` (daily and at the stable gate), not by branch protection.
  - The Share and Export amendment (#385) is approved and merged.
- **2026-10-13: W5 part 1's plan (coordinator).**
  - It was written in stages: four scouts and an architect, then one writer per task applying it to a scratch tree in chunks of four, then a three-lens review with three refuters per finding. All ten findings were applied. The plan holds 332 mutation rows.
  - **Five departures from the spec's text, defined with the block's first five numbers:**
    - (a) the split;
    - (b) an HTML leaf shows a stand-in until W6;
    - (c) the worktree redirect's sentence stays true when the branch could not be read;
    - (d) the 2-2 bound lives in the parse's element count, exactly what the component draws;
    - (x) a base64 `.md` that is valid UTF-8 is formatted, and only bytes that are not UTF-8 get the "Not valid UTF-8." note.
  - **Bounds measured while planning:** highlighting stops at a 256-character word (r10), and a keystroke chord at 64 characters (r11).
- **2026-10-13: the ccd slug fix merged (#386, `6b939bd46`).** A GitHub slug needs a GitHub prefix, ASCII, and no `.` or `..` segment; an owner may not start with a dot, but a repository name may (`org/.github`). It reaches the boxes through ccrc's update mechanism, fleet first.
- **2026-10-13: Share and Export, and W5b's place (operator).** The operator accepted the recommended option on all 12 decisions of the Share/Export design:
  - Share always opens ccrc's sheet, and its access note always shows.
  - Export never fetches; images not yet loaded wait up to 10 s, then become placeholders. The file is capped at 10 MiB.
  - A mockup export is a wrapper around a sandboxed frame.
  - Only leaf pages offer Export.
  - On iOS, Export builds first, then saves on a separate tap.
  - An unpushed commit gets no link.
  - Mockup limits: an open-formatting cap first, then the tag limit is re-derived.
  - The export pins the exporter's theme.
  - Mermaid in HTML specs: W6 lists script-text imports as census-only rows, and `MOCKUP_CSP` is never widened.
  - ccd's slug fix is a standalone PR now.
  - W5b goes after W5 (the rich-docs spec's RD23).
  The amendment is written in place in the 2026-10-01 spec (its §0 row `share-export`). It adds §4.16 Share, §4.17 Export and §5.6.9 mockup export, three figures, and 37 mutation rows. W5 gets Share, Markdown/text/image Export and the `GithubTarget` widening as its first L0 task. W6 gets mockup Export, the script-text census and the formatting limit. M5.16 now owns the carve-out for W4's worker files (Q2, answered) and the export allowances, each with a planted control.
- **2026-10-13: rulings on the amendment's open questions (coordinator).**
  - `bad-slug` (the slug) and `bad-target` (the commit or path) are two refusal words, both confirmed.
  - W5 bounds W4's r10, r11 and 2-2 in the shared Markdown components, because Docs pages render arbitrary repository documents through them. Each bound gets a measured value, a case and a mutation row in W5's plan, and chat gains the same bounds.
  - The rich-docs spec's edits that follow from this amendment are made in the same change: A2a, A2b and M8.10, M9.14, the W8 row (which owns the decision on what Export means on the reader path, and copies through `copyText`), G9, and RD23 answered. Its decision log also marks RD25 and RD27 as ruled (R-g).
  - The design was reviewed by three lenses (fidelity, security, implementability). All 40 findings were applied.
- **2026-10-13: the shared library's first wave.** Its L1 plan was approved by the operator and merged in the library's repository. Its first run is open and waits for a fleet slot.
- **2026-10-13: W4 merged (#381, `baba5c1bc`).**
  - **Wave-done.** The first full suite run was red only under load. Each red file (PWA 5000 ms timeouts, one `ccrc-doctor` case, one `session-hook` case) was green alone, so routing is unchanged.
  - **Review 408** (held-out panel plus the plan's five lenses, 119 agents) found 12 issues. F1 was critical: the built `markdownWorker` chunk threw `document is not defined` on load, because the worker build resolved a dependency's browser entry. Every chat message over 4 KiB would have rendered as plain text. No in-process test could see it.
  - **Fix round 1, rulings:**
    - F1: fix before merge. A worker-only resolution of that dependency's non-DOM entry, plus a test that builds for production and loads the built chunk with no `document`. The main-thread bundle is byte-identical.
    - F6: a refused chat image whose transformed source is empty (`data:`, `javascript:`, an empty source) renders its alt text as text, never an empty link. This extends D-4776, with no new number.
    - F4: M4.P12's spec mutation moves to W5's half. This extends D-4768.
    - The rest: missing cases and rows, carried items recorded truly, words, and the macOS-only `0 warned` case made `itLinux`.
  - **Scoped re-review 412** reproduced F1 fixed and confirmed every ruling landed. Its 8 minor findings are carried to W5 below. Ruled: N1's docstring nits go to W7's prose pass, as the worker routed them; suite row 06 keeps the plan's re-run format.
  - **CI** was green on every Linux leg, on the merge ref that includes #376. The macOS legs were red only in files W4 does not touch.
  - **Claims:** W4 landed second, after #353 and #376, under the scoped co-edit terms. `git merge-tree` was clean at both landings.
- **2026-10-12/13: W4 rulings during the wave.**
  - Coordinator, mail 4397: an `https:/` source counts as root-relative (D-4773).
  - Coordinator, mail 4436: a footnote label counts as a container level (D-4774).
  - Operator, 2026-10-13: before the synchronous render, chat pre-counts table cells against `DOCS_MAX_RENDER_ELEMENTS` (D-4775, review 2-3 option B). Chat shows an image only from an absolute `http(s)://` source (D-4776). This answers Q1. A chat message of 4 KiB or less with a `*`/`_` separator line of 65 or more characters renders as plain text, and that is accepted as is.
  - Q2, M5.16 against the worker's `postMessage`, stays with W6 and the Share/Export amendment.
- **2026-10-13: the shared library's L1 plan.** It is written: 12 tasks, a 77-case conformance corpus and 357 measured mutation rows. It is in the operator's review in the library's own repository. Its coordinator rulings are recorded there as `C<n>`. Ruling C2 refines a comment in this programme's spec §3.2: `render()` returns `{html, outcome, bytes, meta}`, with no overloaded empty value.

- **2026-10-01: spec approved**, with rulings U1-U5:
  - U1: a 2 MiB image cap.
  - U2: a per-view "Load external" tap for mockups.
  - U3: chat hardening, option (b).
  - U4: a required headless-browser CI leg.
  - U5: the pre-existing route defect is reported privately first, then fixed in its own PR after W3.
- **2026-10-04 to 06: W1.** Its departures are D-4150 to D-4164, issued by the allocator and defined in the W1 plan's Deviations section. The ones a later wave consumes:
  - **D-4157:** `docs-index` stops at its deadline and counts the projects it did not reach in an additive `unwalked?`. W2's adapter passes it through, and W5 renders "N not checked".
  - **D-4158:** `ref-locked` requires git's lock-file evidence.
  - **D-4159:** rc 0 beats the time bound.
  - **D-4163:** `--refmap=` and `followRemoteHEAD=never` on fetch.
  - **D-4164:** the draft phase degrades and never fails the tree.
- **2026-10-06: W1 on CI's git 2.55.** Three test assumptions held only on git 2.43:
  - the host's system filter config produces the `filters-bypassed` caveat;
  - a lazy-fetch-blocked `cat-file --batch-check` answers `<oid> missing` at rc 0;
  - the directory/file ref-conflict stderr wording changed.

  The tests are now version-tolerant, measured under 2.43 and 2.55, with no product change.
- **2026-10-06: W2 plan.** Its header lists refinements (a) to (s). Refinements (c), (d), (f) and (g) contradict the spec's text. They are defined as deviations in W2's Task 6 with the first four numbers of the block this coordinator issues at run-open.
- **2026-10-06: sharing (operator).** Fold a Share action and a self-contained Export into W5/W6. Share is the native share sheet or copy-link, carrying the GitHub permalink at the served commit. Export is a single HTML file with inlined images and scripts off. Expiring share links come later, as their own designed wave with a threat model. The design is being settled; the spec amendment follows.
- **2026-10-07: drafts in Share and Export (operator), option (b).** In a view with drafts, Export may include them under a visible "Draft, not committed" banner naming the base commit. Share always sends the committed permalink, with a warning that drafts are not included.
- **2026-10-07: U5 (operator).** Draft the private report for the pre-existing route defect. The draft stays outside tracked text until the fix ships.
- **2026-10-07: plan format (operator).** Plans stay Markdown, in this programme and every other. The HTML preference of 2026-10-06 is for specs, whose architecture decisions and diagrams engineers approve. An amendment to this programme's existing `.md` spec stays Markdown.
- **2026-10-07: W2 approved and opened.** The operator approved the W2 plan, and #306 merged it with this ledger (`a17e14bc0`). Run 315 opened for wave 2/7, with no `sessionId`, so a fresh child is minted. The allocator issued numbers **4374 to 4387** for it. They are written bare here until a plan defines them, because the floor guard reds any `D-` token above the highest defined number:
  - Task 6 Step 6 defines 4374 (refinement c), 4375 (d), 4376 (f) and 4377 (g).
  - 4378 to 4387 serve departures found while executing and in fix rounds. The worker takes them in order and lists each in its wave-done. A departure that changes behaviour the spec states goes to the coordinator as a question first.
- **2026-10-07: R1 (coordinator).** The W2 worker pushes its branch and opens the wave's one PR after Task 9, replacing the plan's "No task pushes or opens a PR" and "Push, PR and merge are the coordinator's". CI runs git 2.55 and the fleet box 2.43, and W1 met three version differences only in CI, so CI must run while the review reads. The merge stays the coordinator's, after the review.
- **2026-10-07: W2 drift, measured.** Applying the plan's whole prototype diff to `main` at `a17e14bc0` moved exactly two Find blocks; every other hunk applies, some at offsets of up to 13 lines:
  - `verb-gate.test.ts`'s `CAP_GATED_VERBS` gained `'ws-expire'` (#312). The set becomes the plan's set plus `'ws-expire'`.
  - `single-definition.test.ts`'s tail grew (#312, #299). Task 8 appends after the real last line.

  The brief rules both as mechanical re-anchors.
- **2026-10-07: claim overlap with run 302.** Claim 1073 (programme `ccrc-history`, wave 2 B1) holds `server/test/single-definition.test.ts` and `server/test/lifecycle.test.ts`. B1 only appends at the end of both; W2 appends at the end of both and edits one line in place in each (the archive door pin's `want` line, and the `../src/lifecycle.js` import). The coordinator proposed a scoped agreement to run 302's coordinator in mail 3812: each side edits only its own lines, and the second to merge takes `main` and keeps both blocks. Run 302's coordinator was busy, so W2 was dispatched before the reply. Task 1 edits neither file. Before Task 2 the worker claims the two files again, and edits them only once claim 1073 has ended or the coordinator has confirmed the agreement by mail.
- **2026-10-07 11:21 UTC: claim ruling (operator).** W2 edits the two files under claim 1073 within the proposed scope, without waiting for run 302's coordinator. W2's worker was told by mail. So were the claim's holder (the protocol's address, named by the claim's own `mailHint`) and its coordinator.
- **2026-10-07: W2's `sd-shape` invariant (coordinator).** Task 9's checker compares each commit with its parent, and two review fixes inserted lines inside W2's own appended block. Measured net against the base, `single-definition.test.ts` changes by exactly the in-place `want` line plus one end-of-file block, and the citation census is green. The FAIL is recorded as it stands, without a re-run or a checker edit. The wave-done keeps `suite: unrun`. This is not a deviation.
- **2026-10-07: W2's held-out review (run 317, tip `03826657e`).** 8 lenses, all returned. 18 findings raised, 2 survived the refute pass, 0 unexamined. Every Task 9 suite reproduced, and all 161 mutation rows red as recorded.
  - **F1, important: fixed.** Check 8 coerced a non-string `onRef`. An array passed as ok, and a throwing `toString` rejected the port's promise.
  - **F2, minor: fixed now.** Refinement (g)'s single reader of `killed` and `signal` had no scan that went red on a second reader.
  - **Settled by the review:** check 3's half-measured shape is covered by W2's deviation 4377. The second redaction pass's depth bound (4378) is beyond every failure body W1's helper emits. Thirty-two guards have no mutation row, but each went red when the reviewer mutated it, so coverage is complete.
  - **Deviations defined in W2's plan on its branch:** 4374 to 4378, written bare here until W2 merges.
- **2026-10-07: W2 fix round 1.** Commits `52a884b01`, `64ebe8351` and `2190cc43f`. 163 rows measured as expected. No new deviation.
- **2026-10-08: W2's scoped re-review (run 336, tip `2190cc43f`).** Five lenses, all returned. 23 findings raised, 17 survived, 0 unexamined. Both of review 317's findings are closed. Every suite, all 163 rows and the claim scope reproduced.
  - **F1, important: fix now.** The one-reader scan blanks comments and strings, but it has no template or regex state. A `/*` inside either literal hides a second reader on a later line.
  - **F2, minor: fix now.** Ordinary spellings evade the receiver match: an element access, a `!` after `)` or `]`, and a member chain split across lines.
  - **F3, minor: fix now.** An arrow-form `ccdEnding` scopes its body past its own end.
  - **F4, cosmetic: fix now.** One results note still says 161 rows.
  - **F5: accepted.** One re-anchored row's plan fence keeps its pre-fix text, as four earlier rows already do.
  - **Scope (coordinator, from W3): fix now.** W3's `lane.ts` reads AbortSignals (`w.signal`, `controller.signal`), and the scan reds every `.signal` read. A `.signal` read now counts only in a file that imports `lifecycle.ts`, and that set of importers is pinned. `.killed` stays checked everywhere. W3 then needs no edit to W2's scan.
  - **Also accepted:** the scan's two allowances beyond `ccdEnding`: the four `ExecResult` reads in `ccd()` and the one bound `ending.signal`. A type-aware scan was considered and not chosen, because the installed TypeScript 7 exposes only an `unstable/*` JS API.
  - **No new deviation:** each fix brings the scan into line with refinement (g)'s wording, "a read on a CcdResult".
- **2026-10-08: W2's second scoped re-review (run 337, tip `4017e8262`).** Six lenses, all returned. 24 findings raised, 17 survived, 0 unexamined. Every fix-round 2 item is closed. W3's four planned files pass the scan unedited, and an AST census found no code that the scan's blanker hides, in today's tree or in W3's files.
  - **F1, important: fix.** The rule that decides where a regex starts has an operator arm and a keyword list with no mutation row. Deleting the operator arm hides a reader behind `(s) => /x'y/`.
  - **F2, minor: fix three of four.** Importer detection on blanked text, the bare-import arm and the specifier anchor each get a row. The broken-chain tail's `!?` changes only the printed receiver, so it is accepted.
  - **F3, minor: widen three, name the rest.** A chain broken after the dot, a repeated `!`, and an import after another statement on its line are caught. Import-equals, subdirectories, re-exported types and exotic spellings are named as known evasions.
  - **F4, minor: fix.** A backslash-newline inside a string shifted later line numbers.
  - **F5, minor: fix.** The scope CONTROL is rebuilt from the W3-shaped file itself.
- **2026-10-08: the scan's evasion list is not exhaustive (coordinator).** Fix round 2 asked that list to name "exactly what still evades". A text scan cannot meet that, and each review found new spellings. The list is now "known evasions". Fix round 3 is the last on this scan. Its review checks the round's items, and any new evasion spelling becomes residue for a later wave, unless it hides a reader through a spelling already in the tree or in W3's files.
- **2026-10-09: W2 lands second after ccrc-history B1.** #315 merged first, as agreed. #319 then conflicted only at the end of `single-definition.test.ts`. The worker merged `main`, kept B1's text where `main` has it, and put W2's block last.
- **2026-10-09: W2's closure review (run 343, tip `0acbfadea`).** Every item ruled in fix round 3 is closed. The merge is clean. All suites pass, and all 189 mutation rows are red as recorded.
  - Four minor findings, carried as residue, not fixed. Two rules in the one-reader scan ship without a mutation row: the after-the-dot arm's blank-line skip, and the bare import after another statement. Both only widen what the scan catches. The other two: three docstring wording slips, and one results note that does not name W2-T5-M1's moved first red case.
  - Four new evasion spellings, none in the tree or in W3's files: U+2028/2029 in a line comment, backslash-CRLF in a string, a string-named import specifier, and a type argument's `>` before a division.
  - **Ruling:** accepted, and #319 merged at its reviewed head.
- **2026-10-09: an undispatched review run pins its work run (coordinator lesson).** Review 343 was opened and then waited on the daily cap. When `main` moved, the coordinator could not close 343 (`not-dispatched`), and that blocked sending run 315 back (`review-in-flight`). The workaround: the worker merged `main` while 315 stayed at awaiting-review. 343 then dispatched against the merged tip, and 315's fingerprint was corrected after 343 closed. Open a review run only when its dispatch can follow at once.
- **2026-10-08/09: claim agreements for W3.**
  - Claim 1105 (ccrc-history B1) on `single-definition.test.ts`: agreed by its coordinator and holder. It ended when #315 merged.
  - Claims 1115 and 1116 (box-token-lifecycle wave 1, PR #330) cover `server.ts`, `auth/gate.ts`, `auth-gate.test.ts`, `box-token-census.test.ts` and `single-definition.test.ts`. Agreed by the holder: the second PR to land merges `main`, keeps the other's routes, census entries and blocks, and re-measures every count.
- **2026-10-08: W3 approved and opened.** The operator accepted the plan ("plan accepted"). Run 342 opened with block 4464 to 4479. Task 9 Step 7 defines the first six, for (d), (i), (j), (s), (v) and (w); the other ten are reserve. A drift replay on `main` plus W2 found only Task 8's route counts moved (#320 added two routes). The brief settles that by re-measurement, and a review of the brief found six defects, all fixed before dispatch.
- **2026-10-09: W3 ruling during the wave: a WebSocket upgrade bypasses the docs headers (coordinator, mail 4082).** The root websocket plugin answers an upgrade to a docs route with a 101 before the docs plugin's `onSend`. The upgrade passes the gate and provenance first, carries no body and runs no exec, and a browser cannot reach it. It was ruled a deviation (4471), like refinement (d), and pinned by three tests.
- **2026-10-09: W3's review (run 361, tip `77862e265`).** All eight deviations (4464 to 4471) are real, with true rationales. 13 findings: four important guards had no failing case (the show shape at the route, provenance at `onRequest`, the cache-hit raster rules, two tree shape clauses). Fix round 1 also moved the lane's admission and overflow comparisons into L1, and the blob cache now copies at fill, so its charge bounds the memory it holds. The generation-map growth (about 560 B per refreshed name) stays the plan's carried item. Scoped re-review 364 was clean, and #339 merged at its reviewed head.
- **2026-10-09: W4 planned in stages (coordinator).** Ground scouts and an architect, writers that applied each task to a scratch tree, then a three-lens review with refuters and one fix pass. The stages kept the coordinator's mail gate from going deaf for hours. Four departures from the spec's text: (a) six rows written against W5 parts are proved on W4 stand-ins, and their W5 halves move to W5's brief; (b) M4.M1's plugin-order mutation cannot fail, so it is replaced; (c) `docs-sw` counts with bash builtins, not `grep -c`; (d) `docs-sw` SKIPs on either fleet signal. W4's run is open with block 4768 to 4783.
- **2026-10-09: two operator questions from W4's planning.** Q1: should chat show images only for absolute `http(s)` URLs? That is stricter than U3's root-relative and protocol-relative refusal, and closes the path-relative same-origin GET. The plan follows the spec; a ruling changes one predicate and adds a deviation in Task 10 Step 8. Q2: W6's M5.16 scan forbids `postMessage` in the Markdown code, and W4's worker files need it. The Share/Export spec amendment should exempt them.
- **2026-10-12: the W4 plan merged without a recorded approval.** #345 merged 2026-10-10 at 21:10 UTC as `995a05750`, so the plan is on `main`. Q1 and Q2 stay open; W4 dispatches with refinement (k) as written, and Task 12 carries Q1.
- **2026-10-12: a shared renderer, and ccrc's reader as the operator's docs server (operator).** Rulings, in the operator's session:
  - Each product keeps its own docs server (transport, auth, content source, hosting). The rendering (Markdown rules, the rich layout, fonts, a self-hosted Mermaid, a conformance corpus) becomes ONE public library in its own repository, pinned by exact version. Its own small programme builds it, coordinated from here, because ccrc needs it first. W4 is unchanged; W5 stays plain plus a real `<br>`; ccrc mounts the library in a sandboxed frame in a later wave.
  - ccrc's Docs reader, at ccrc's own address behind the same passkey session, replaces the standalone docs server for the operator, at feature parity.
  - The library is MIT, and named `docserver` (package `@<scope>/docserver`; the unscoped npm name is taken, and the scope is open).
  - Page URLs may carry a commit as `at=<sha>` for the version view.
  - Roots outside ccd's projects root are moved under it, as an operator step before the standalone server retires, only when no live session works in them.
  - Another viewer's coordinator confirmed the change on its side and sent eight needs, folded into the spec's §3.2.
  - The design is `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` (approved by the operator 2026-10-12, R-g). It proposes W5b and W8 above, and amends M7.9 so that the library's exact package specifier may appear in the PWA.
  - About 14:07, in this session (R-g): the library programme starts now; the library's repo is private until v1 and public from v1; the npm scope is `@synapsium-labs`; the spec is approved as written. W5b's placement (after W5 recommended) is still open.
- **2026-10-12: W4 claims (coordinator).** Run 377 (#353) and run 354 hold four doctor files, `deploy.sh` and `installTreeFixture.ts`, which W4 edits in Tasks 9-10. Scoped terms were agreed by mail 4321 and 4324 (run 377's holder and coordinator) and 4322 (run 354's holder): each side edits only its own lines; the second to land merges `main`, keeps both and re-derives every count. A replay of W4's prototype onto `main` at `28e8dc1b2` moved only Task 10, at three file ends where box-token lifecycle landed after the plan.
- **2026-10-12: W4 ruling during the wave (coordinator, mail 4354).** Task 3's review found three shapes that pass §4.10's pre-scan and then nest the parser deeply: a tab between container markers, a fence opened inside a list item or an HTML block, and nesting continued by indentation. The backstops hold: `threw`, the depth cap and the worker budget. Ruled:
  - harden the first two (tabs column-aware; the fence skip applies only to the delimiter-run check), with cases, mutation rows and a false-refusal control. This is a departure from §4.10's algorithm text, defined with a reserve number at Task 10 Step 8;
  - reword `markdownGuard.ts`'s header to name the real bounds;
  - carry the third shape and chat's main-thread cost on a crafted message of 4 KiB or less (about 0.5 s measured) to the results and to the operator with W5's planning. Routing chat's sync path through the caps is out of W4's scope, because U3 says it renders exactly as today.
- **2026-10-08: W3 plan.** Written by a planning workflow: scouts, an architect, one writer per task prototyping on a scratch tree at W2's tip, a plan review and two fix passes.
  - **12 tasks.** Task 11 is the whole-branch review, run before Task 12's close. Task 12 pushes and opens the PR.
  - **Six departures from the spec's text,** defined by Task 9 Step 7 with the first six numbers of W3's block:
    - (d) router-level 414/400 refusals;
    - (i) the composition built in `buildServer`, with no `index.ts` edit;
    - (j) abandonment measured on the response's close;
    - (s) the latency test on a bare Fastify;
    - (v) the fetch lane's own FIFO instead of a second `KeyedQueue`;
    - (w) a JSON file reply serving the bytes check 8 verified.
  - **Why (w) counts (coordinator, 2026-10-08):** §3.5 says "wraps these answers unchanged", and the served field differs for an answer outside ccd's contract.
  - **What W3 settles:** every item W2's reviews carried to W3, and review 317's notes.
- **2026-10-07/08: two coordinator lessons.**
  - A long workflow keeps this session "busy" to the mail gate. Review 317's report sat queued for nine hours, so check mail on every wake.
  - `mail list --to <id>` lists only outstanding mail. A send that timed out and was later acked looked unsent, and was sent twice. Verify a send through the feed or `--all`.

## Carried constraints (reviewers get these)

- **No compressed shell copy without a server guard** (from compression's F3 and ask 302, 2026-11-04). The server sends a pre-compressed `index.html` or `sw.js` copy whenever one exists on disk; today only the build keeps them out (`assets/`-only copies and `emptyOutDir`). Any change that writes a shell copy must add a server guard first.
- **Compression residue, for the next wave that edits `server/test/pwa-static-cache.test.ts` or the compression plan** (from review run 1417):
  - **A last-listed negotiator.** The q-value case alone passes a negotiator that ignores q and takes the last listed coding; today only the refused-coding case reds it. Send both orders, or add a second case.
  - **A blank line.** The plan's `### Named, without a number` heading has no blank line above it.
- **Export residue, for the next wave that edits `pwa/test/docs-export.test.tsx` or the Export plan's results** (from review run 1406; the coordinator's rulings of 2026-11-04). W5h-b (run 1412) takes them as 7929:
  - **A direct element check.** Restore a direct check that no `b` element arises from the planted worktree segment. Today only text checks and a substring check hold the comment's claim "no element comes of it" (F2).
  - **A row for the quote.** Give the as-written assertion on the `ccrc:worktree` meta a measured mutation row: the export's one string sink in `buildExport.tsx` can write the quote raw. The plan's sentence that no single edit can do so is wrong (F3).
  - **Plan-text errata in `## Export results`.**
    - Row W5X-T13-M8 fails 3 of 11 cases, not 3 of 10; rows M1 and M2 still say 9 cases, and M1 names a renamed test (F1).
    - The browser re-run line does not reconcile 21 cases (F4).
    - 7891's "What holds it" bullet does not name the built-shell pin or the widened layer census, and its tag omits review 1405 (F5).
- **W8a residue, for W8b** (from review run 1318 and the W8a plan's "Carried, not fixed"):
  - **The pending fragment is spent too early.** It is spent when the mount resolves, which is before `ready`. A fallback raised after the mount then loses a heading deep link. Spend it on `ready`, and add a case that falls back after the mount has resolved.
  - **A same-page link spelled with its file name does not scroll the reader.** A link such as `this.md#sec` routes to `hash` and only rewrites the address bar. Fixing it needs either an in-frame `#id` re-issue or a scroll op on the host, plus a test of what actually moves.
  - **An overlong image `src` drops the whole doc to the plain view.** That happens when the `src` passes the library's 2048-code-unit seed limit. Leave such a ref out, in W8b or in W6 with the planner.
  - **The copy check never runs against the real library for U+202E and U+200B.** Add one case through the real mount, or a browser copy tap.
  - **One browser sub-case cannot fail.** The `hash` sub-case of the `M8.B5 parent.postMessage` row cannot fail. Assert `location.hash`, and add a positive case through the port.
  - **The browser battery's control gaps:**
    - the meta-only row measures 26 channels against the frame's own policy;
    - in the default browser, the second-load row credits the shell meta with a block that Chrome's local-network checks also make;
    - in the navigated-child control, the wrong-nonce `ready` comes last;
    - the `parent.postMessage` navigate case has no control;
    - the navigated-child control (`M8.B5 control`) waits a fixed 500 ms after the frame settles for the child's hello. It failed once in the merge queue on 2026-11-04 while the next group passed it; wait on the hello with a timeout instead.
  - **Smaller items:**
    - the render job's budget also covers the first lazy import of the renderer chunk;
    - the `window` and `globalThis` owners of the window-message scan have no planted control;
    - M7.9's position check is a line-prefix scan, so JSX text passes it;
    - some header comments still say "two sheets";
    - the comment in `assets.ts` overstates what the guard covers;
    - `ci.yml` and the plan word the need for `attestations: read` differently;
    - `policy.ts` imports a type from `DocLink.tsx`, and `docLinkTarget` through a hook module;
    - `images.ts` (L3) imports `DocImage.tsx` (L4), which W6's planner replaces.
- **W3's accepted residue, from its plan:**
  - The fetch lane's generation map grows by one short entry per distinct project refreshed. It is session-gated and cannot be pruned safely.
  - `policy.ts`'s `lowerAscii` duplicates a private L0 helper. It is pinned by a parity case and goes to W7.
  - The second redaction pass rewrites values, not key names. This is latent, and the fix belongs to L3.
  - The `JSON.parse` cost inside `ccdsource.ts` is deferred.
- **W2's parked minors** are in its SDD ledger, and none blocks W3.

- **SEC-3:** a helper killed from outside leaves git's process group running. W2 pins the budget invariant, so ccd is never killed in normal operation. The real fix is unscheduled.
- **SEC-4:** fetch stamps accumulate, one per distinct branch name (W5 housekeeping).
- **No stamp after a failed post-fetch for-each-ref** (W5).
- **`branch: null`** covers both a detached HEAD and an unmeasured read (W2 adapter and W5 rendering).
- **Closed (#627):** `GithubTarget` now expresses `resolveDocRef`'s `repo` kind (`repo` and `root`, M3.16-M3.18); see Decisions, 2026-11-02.
- **A commit missing from a partial clone** answers `git-failed {step:'cat-file'}` on git 2.43 and `unknown-commit` on 2.55. W2 carries it in its results and does not close it.
- **Over-cap `too-many-entries`** reports `bytes` measured on a stripped body.
- **W7 prose residue:**
  - stale `ccrc-doctor-checks` citations in `ccd/ccrc` that predate W1;
  - `deploy/account-op.mjs:586` cites `:166`, which W1 moved to `:173`;
  - spec §7.2's two python3 / placement sentences;
  - the lockAgeMs prose in the spec;
  - docs-shared's claim about two refinements;
  - the dropped clause "git 2.43 ignores the key".
  - README's doctor table has no row for W1's `docs` check, and its server-role SKIP sentence (the D-3111 list ending "`timeout` and `model-default`") does not name `docs`, although `_check_docs` SKIPs on a `CCRC_ROLE=server` box (reported by another session in mail 3818, 2026-10-07; README is under another programme's claim, so W7 places it).
- **W2's one-reader scan residue** (review 343): two unpinned widening arms, three docstring wording slips, the W2-T5-M1 note, and four evasion spellings to add to its "Known evasions" list. This is for the next wave that edits `docs-source.test.ts`, or for W7.
- **W3 residue:** two Task 12 tool texts and one Notes count (review 364); the plan's Task 4 Decision 1 text against the moved L1 verdicts; W2's closed plan rows anchored on `laneAdmit`'s old inline clause. For W7's prose pass: the `coord/store.ts` and `coord/close.ts` comments that say no `app.setErrorHandler` exists, §5.3's "every docs response", which should name the router-level and upgrade escapes, and W4's two stale comments (`pwa/src/lib/api.ts`, `server/test/sourceScan.ts`).
- **W4 residue for W5** (review 412, minor):
  - R1: pin both halves of the dev alias's scope (`serve` only, never under vitest), with a row each.
  - R2: correct the words of the docs-sw `/wiki/docs` case, which pin the RegExp's `/^` and not the ERE's `^`.
  - R3 and R4: re-record the measured `red` lines of W4-T11-M52 to M55, M58 and M59, and of W4-T6-M5.
  - R5: give the hook's commit-to-effect window its own Carried entry with a measured example. It is W4's own code, not pre-existing.
  - R6: two stale comments, `vite.config.ts` ("below") and `markdownWorker.ts`'s quoted `worker:` literal.
  - R7: reword `markdownGuard.ts`'s `table-cell`. Tailwind scans it and ships an unused `.table-cell` rule.
- **W4's carried items** (its results' "Carried, not fixed", inherited by W5's brief):
  - nesting continued by indentation (shape (c));
  - the sync path's cost on a crafted message of 4 KiB or less;
  - review 1-4;
  - the 2-2 residual (per-span keystroke cap, about 204 850 elements from a 205 KB message);
  - N1's minors;
  - M4.P12's "count only after render";
  - r10 and r11. highlight.js is quadratic on one long identifier run, and `keystrokeParts`' split is quadratic on a long whitespace run. Both are pre-existing at base, and W5's page inherits them through the shared components.
    - (2026-10-15) W5h closes the highlight.js half by moving highlight.js off the main thread. r11 stays with part 1's keystroke bounds.
  - Review 5-2 goes to W7. W6's M5.16 carry stands.
- **W7 prose residue from W4:**
  - `ccd/ccrc-doctor-checks`' table line for `auth box-token` says `_check_box-token` is at the END of the file, which is no longer true.
  - N1's docstring nits.
- **U5:** the private vulnerability report is not filed yet. The spec's one-line mention is public since #301.

## Next-wave brief (Export), after W5h-a and Share merged

The operator approved the plan on 2026-11-03 with every recommendation (Q1 A, one run). Run 1368 dispatches once the plan is on `main`.
- **Plan:** `docs/superpowers/plans/2026-11-03-native-docs-reader-w5-part2-export.md`, Tasks 1 to 13, in order. It reads W5h-a's store by `peek` and, for each drawn copy, `copySkip` (D-7762). It holds the `publish` slot (D-7755), and treats a fallback body's `publish(null)` as a body with no highlighting to wait for (D-7763). It adds Export's clause through Share's seam.
- **Deviations:** at least 14 numbers, minted at the run's opening, for (a), (b), (c), (e), (f), (g), (h) and (w) in that order; the rest are for departures found while executing.
- **Lessons the brief carries:**
  - the close runs the whole `server` suite in pieces, because other programmes' closed censuses reach PWA words;
  - the browser files run locally, because the PR's CI skips them;
  - unused issued numbers are written without the prefix;
  - a review child may run `npm ci` in its own `server/`, `pwa/`, `agent/` and `ui/`;
  - a test that holds the in-thread highlighter waits for the request before `release()`, because a code block posts it from an effect React may run after the plain frame (#2192);
  - a `docs-scans` describe that copies `pwa/src` carries `{ timeout: 30_000 }` (#2192; the plan's own clause already does).
- **Parallel work:** no other Docs wave runs beside Export. Its census and scan files are shared with other programmes; each edit is one entry or an appended describe.

## Next-wave brief (W5h-a and Share), after W5 part 1 merges (done: both merged 2026-11-03)

W8a is accepted (2026-11-01, #2061). W8b follows W5b, and starts from the W8a residue in Carried constraints.

Part 1 merged on 2026-10-19 (#627), so this brief is now the next dispatch. Two runs dispatch in parallel: W5h-a and Share (the operator ruled W5h and Share in parallel on 2026-10-15; W5h-a is the coordinator's split of W5h). Export follows W5h-a and Share, and W5h-b follows the phone measurement.

- **W5h-a, highlighting off the main thread: the worker path.**
  - **Spec first:** the amendment to the 2026-10-01 spec, with the rich-docs spec's cross-references, merges before the plan is dispatched.
  - **Plan:** `docs/superpowers/plans/2026-11-02-native-docs-reader-w5h-a-highlight-worker.md`, written from the approved design: the pure grammar modules; a generic runner with a ready handshake and a detach abort; the highlight worker; the two singletons and the second chunk; the store; `CodeBlock` with the HTML check; the Docs and text-leaf wiring; chat; the scans; the measurement page; the constants at provisional starting values; the hand-off to Export; the library asks. Part 1's bounds stay in force throughout.
  - **Measurement:** once W5h-a is deployed, the operator opens the measurement page, behind the session gate, once on the phone.
- **W5h-b, the measured values and the retirement,** after that measurement. Its own plan, PR and review: the constants set to the measured values, then, in a commit of its own, all of part 1's main-thread highlight bounds retired, with their rows re-pointed. The retirement lands only if every real block, cold, finishes within the operator's per-block bound, with the deadline set between the slowest block and that bound; otherwise the numbers go to the operator.
- **Deviation blocks:** issued at each run's open.
- **W5 part 2, Share.** Its plan, `docs/superpowers/plans/2026-11-02-native-docs-reader-w5-part2-share.md`, takes the Share half of the 2026-10-13 Share/Export amendment. It renders no body and does not touch highlighting.
- **Then W5 part 2, Export,** after W5h-a and Share merge; it does not wait for W5h-b. It reads W5h's highlight store by peek only, waits for it to settle within the page ceilings, and says in its provenance when colouring was partial or dropped. It also carries M4.SH3's and M4.SH8's Export halves, moved from Share (2026-11-02).
- **Claims:** W5h-a and Share are checked against each other at dispatch. The second to merge takes `main` and re-measures.
- **Branch discipline:** commit on the workspace's own branch, never a separate feature branch.

## W5 part 1's brief, for run 413 (dispatched)

- **Plan:** `docs/superpowers/plans/2026-10-13-native-docs-reader-w5-part1-docs-screen.md`, Tasks 1-14. Task 13 is the held-out whole-branch review. Task 14 pushes and opens the one PR.
- **Base:** `main` at dispatch. The plan was written at `a59685566`, so any drift in its files is replayed and named in the brief.
- **Routing:** an Opus·high main loop with Sonnet·high implementers. Opus·high task reviewers and Task 13's panel. Workflows off, `compact 40`.
- **Branch discipline:** commit on the workspace's own branch, never a separate feature branch.
- **Deviation block:** 4917 to 4932. Task 12's Deviations step defines the plan's five departures with the first five numbers.
- **Claims:** the plan's shared-file list, checked at dispatch. A claim held by another run on `server/test/single-definition.test.ts` and `pwa/src/lib/api.ts` needs scoped co-edit terms: the second to merge keeps this wave's appended describe last.
- **Merge gate:** the operator's W3 dark rollout, then R2 and R1 (spec §7.8).
- **Carried constraints:** the list above.
