# Native Docs reader — remaining delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task, under the dispatched `ccrc-worker` role. This is one programme with serial work/review runs, not permission for one worker to execute every wave. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish native Docs delivery through installed-build verification and an honest handover, preserving the separate operator-only standalone retirement gate.

**Architecture:** Reuse the approved take-up and W5b leaf plans. W6 adds a bounded mockup/asset pipeline separate from the sealed reader; W8b uses the existing history/version transport through the one library adapter and a pure bounded diff. W7 reconciles carries, documents the shipped source, runs independent review and records release/deployed evidence.

**Tech Stack:** TypeScript, React 19, Fastify, the existing ccd Python helper, package-local vitest, existing browser harness, `@synapsium-labs/docserver` exactly 1.1.0, existing parse/render and highlight workers. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-11-07-native-docs-reader-completion-design.md`; base spec `2026-10-01-native-docs-reader-design.md` §5.6–5.8; rich-docs spec `2026-10-12-rich-docs-reader-and-shared-renderer-design.md` G1/G4/G5/G6/G7 and retirement gate. Read the spec with this plan.

**Status:** 2026-11-07 completion plan. No remaining implementation is claimed complete by this document. A uses planned run 1532; later run IDs and deviation blocks are issued at their actual opening, not invented here.

## Global Constraints

- Exact release is `v1.1.0` at `50cef012aa671974473d19c2acd77f900e9d03af`; npm integrity is recorded in the take-up plan. Recheck provenance at execution; do not repeat signing/publication approval.
- Preserve both 2026-11-06 phone blocks byte-for-byte. `E17-READING does-not-hold`, `E17-BLOCKS 2`: production on-request. An old `auto` block is not proof of after-ready or the 1.1.0 build.
- Reader sandbox exactly `allow-scripts`; shell CSP meta exactly `frame-src 'none'`; no same-origin, popup/top-navigation widening, second reader renderer, protocol parser or parent window-message listener.
- Mockups: static sandbox empty, scripted sandbox exactly `allow-scripts`; no MessageChannel/message listener. CSP meta first, click guard second; attribute equals meta. Second load tears down, never loops.
- Existing `ccrc:reader:v1:` storage; separate parse/render and highlight workers; no main-thread highlight fallback.
- HTML at most 2 MiB, above 1 MiB tap-to-render; prescan depth 256; asset count 64, aggregate 5 MiB, CSS recursion 3, queue concurrency 2. Reader-specific seed limits can be stricter and are not raised.
- Diff inputs at most 20,000 lines each and the existing Docs byte cap; at most 2,000,000 work units (line comparisons plus frontier advances/trace cells) and 512 output ranges/removals; overflow unavailable, no partial result.
- Fixture HOMEs only, poisoned gh where a fixture spawns tools, no live ccd mutation, tmux/registry/unit changes, secret printing or token argv. Fleet changes only through the coordinator API. Refusal is stop/report, not workaround.
- No new worktrees, repository copies, installs or disk-heavy experiments in the coordinator's session. Dispatched children use their own server-created workspace and existing approved install spine only. Mutation scratch is outside the worktree; sequential saved-copy/sha-checked restoration, never git checkout.
- Heavy tests/typecheck/browser/mutations through `ccrc test`, foreground with tool timeout at least 600000 ms. Inside the recorded run use package-local vitest, never bare npx. Each mutation child gets `timeout -k 10 600` (900 for browser) and a measured process cap no greater than 4096; lower it if available headroom requires it. A timeout is not a passing red.
- One task commit after red/green; review fixes one commit per finding. Commit on the workspace branch, never a feature branch. Stage by path; no rebase, force push, update-branch, admin merge, protection/settings change or raw worker clear.
- Allocate and define deviations in the same act at run-open, describe known departures then, carry the issued block in the brief. Workers never guess a number or mint mid-wave. Record unused issued numbers without a definition token.
- Whole changed-file and outward-text privacy scan: actual rc 0, zero hits, including dotted-number shapes. Scan mail/dispatch/PR text before sending, list mail before push and wave-done. No private identities, absolute deployment paths or private security reports in public docs.
- The first rollout containing W5b-1 is **server-first**, whichever tag contains it. Only after both boxes run it does ordinary ordering resume.
- Existing approvals are not re-opened. Coordinator calls below are labelled as such. Reserved operator actions stay reserved; no impersonated ticks or device measurements.

## Review Focus

| Failure mode | Expected behaviour | Owning tests |
|---|---|---|
| Abort, body replacement or fallback while history/diff/asset work resolves | No late result applied to another doc, pending fragment preserved | Tasks 6, 12, 13: stale completion, abort and fallback cases |
| Draft asset deleted/withheld/renamed or auth fails | No fallback to committed bytes; visible truthful failure and bounded retry | Tasks 6, 8: verdict table, one relist, 401 sign-in/retry |
| Reconstructed formatting, nested CSS, huge diff | Refuse before expensive work or return unavailable, never partial unsafe output | Tasks 5, 7, 11: pre-parser counter, recursion/budget and diff exhaustion |
| Copied/shared/exported version differs from opened bytes | Preserve pin/ref and disclose unavailable provenance; no active app-origin export | Tasks 4, 9, 12: version links, output structure, invalid `only`/hash |
| A green check skipped the browser, or an old phone block is reused | Exact-tip actual browser/full-suite plus released-build device evidence | Tasks 10, 14, 16, 17: check-step and evidence receipts |

---

## Delivery units and file ownership

Paths below are relative to the repository. Existing-file anchors are symbols/content, not frozen line numbers. A Find block that stopped matching is remeasured before a brief is changed; it is not blindly patched.

| Unit | Tasks | Work product | Shared ownership |
|---|---|---|---|
| A | 2 | Existing take-up plan, Tasks 1–10 including Settings | Its scope table; no W6/history implementation |
| B1 | 3 | Existing W5b Tasks 1–13 | ccd/agent/server/shared/section tables |
| B2 | 4 | Existing W5b Tasks 14–22 | URL/visit/header/Share/history loader |
| C1 | 5–7 | Prescan, typed plan, bounded loader and CSP | New `pwa/src/docs/mockup/**`, existing image decisions |
| C2 | 8–10 | Viewer, reader asset integration, static mockup Export | DocsLeaf, ReaderFrame, DocImage, Export and UI/scan tests |
| D | 11–14 | Diff/history adapters and reader/lab residue | Reader bridge/policy/frame, lab tests, narrow source scans |
| E | 15–16 | Source-backed carry closure, docs, final review | README, project CLAUDE, current guard/test owners |
| F | 17 | Release/rollout/evidence/handover receipt | Coordinator ledger only unless a measured defect returns to a worker |
| Cutover | 18 | Operator receipt | No feature-worker infrastructure edits |

### Common acceptance cycle for implementation tasks

Every task below explicitly calls this cycle with named files/cases. Write its tests first, run the listed command and record the expected assertion failure; implement the declared interface; rerun to green; run related suites; measure each named guard mutation independently; restore/hash-check; commit paths by name with the standing attribution. No tests of mock behaviour substitute for an assertion on real output/DOM/argv. A test already green at baseline is evidence of an existing guard, not a newly measured fix.

Commands shown below are the command bodies passed to the existing `ccrc test` foreground runner where heavy; use the runbook's installed CLI syntax, not an invented wrapper. Unit command template: from the named package, `./node_modules/.bin/vitest run test/<name>.test.ts`. Browser: from pwa, `CCRC_CHROME=<brief chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/<name>.browser.test.ts`. Typecheck: each affected package's existing npm typecheck command or local tsc configuration. Record the actual invocation and exit code in task notes.

### Task 1: Freeze the completion receipt and next brief

**Owner:** coordinator, documentation only.

**Files:** this plan's `## Results`; `docs/superpowers/programs/native-docs-reader.md`; per-run task notes folded into the ledger on its own ledger PR, never a feature PR.

**Interfaces:** produces `CarryReceipt`: one Markdown table row per design §7 group, with `source`, `measuredRef`, `status`, `ownerTask`, `testOrEvidence`, `disposition`. Status vocabulary: `open`, `already-fixed`, `fixed`, `accepted`, `deferred`, `blocked`. No empty/unknown row at E's close.

- [ ] Measure current identity, mail, planned run 1532, open PRs #2346/#2350 and claims through the installed client. Stop on refusal or another owner. Do not reopen closed runs.
- [ ] Pin the actual dispatch main commit. Record that this design's inspected main was `ebd95592b307912beda71a14662b21acf179b612`; inspect later commits affecting owned paths, not all repository history.
- [ ] Copy the finite carry groups from design §7 into the receipt with owning tasks 5–17; mark historical unverified rows open, not fixed. Attach existing closure evidence where already available; no new security detail published before private triage.
- [ ] Review the A brief against the amended take-up plan and both exact phone blocks. Include Task 9 Settings access, on-request selection, release/integrity, scope/claims, actual base, issued deviations and literal routing. A brief must not just say “finish Docs”.
- [ ] Check changed docs and all outward text, commit ledger documents, read complete exact-head CI and obtain plan/brief review before landing. This task does not dispatch or implement A until its entry gates hold.

### Task 2: A — released library take-up and discoverable diagnostics

**Files/interfaces:** exactly the amended `2026-11-05-native-docs-reader-library-1-1-take-up.md`, Tasks 1–10. It owns `ReaderMount.command?`, `ReaderMountInput.chrome`, progress and one-bar context; no duplicate type contract here.

- [ ] Execute that plan from merged main, including Task 9's separate Reader lab and Measure highlighting links after the five Settings section rows. Keep `SETTINGS_SECTIONS` unchanged.
- [ ] Record its red/green and mutation table, all three Mermaid paths and combined reading. Confirm both original phone blocks unchanged; no assertion that auto proves after-ready.
- [ ] Measure phone title ≤61 CSS px, console portion ≤48 CSS px, tap floor 44 px, tablet/desktop deltas ≤1 px. Verify ordinary and modified Settings clicks and real command/route wiring.
- [ ] Complete Task 10's exact-tip PR checks, separate review run and protected queue landing. Update ledger with actual merge/release state, not merely wave-done. Do not close run 1532 until its successor exists and the merge is measured.

### Task 3: B1 — six sections and bounded history service

**Files/interfaces:** `2026-11-05-native-docs-reader-w5b-parity.md` Tasks 1–13; produces `DocsLogAsk`, `DocsLogEntry`, `DocsLogOk`, `DocsHistoryResponse`, `docs-log-v1`, `docs-sections-v2`, gated history route. Existing detailed grammar/cap tables are authoritative.

- [ ] Execute Tasks 1–13 only, after A and the amended W5b plan merge. Recheck Find blocks and claims, including new Settings ownership; do not edit A's unrelated files.
- [ ] Verify older four-section fleet, unknown caps, absent grant and six-section cases end to end. Unsupported performs zero execs; history truncation/redaction/path matching/budgets remain distinct.
- [ ] Run package suites/typechecks and `GROWTH_CHECK=1` with the issued waiver; do not lower the growth ratchet or ccd capability census.
- [ ] Accept separate review and exact-tip queue checks, measure merge and record the server-first first-rollout constraint in the next brief and release receipt.

### Task 4: B2 — version pages and history loader

**Files/interfaces:** same W5b plan Tasks 14–22. Its `DocsHistoryLoader` is separate from `DocsLoaders`:

```ts
interface DocsHistoryLoader {
  history(project: string, ask: DocsLogAsk): Promise<DocsHistoryAnswer>;
}
```

- [ ] Execute Tasks 14–22 after B1 merges. Apply the actual item 50 answer: Q1 a, Q2 a, two runs. No extra approval request.
- [ ] Prove full 40/64 lowercase-hex `at`, `ref` retained on reload/share, Back to latest removes only `at`, body links/images retain version under the plan's listing limitation, truthful Share/export-body link rule.
- [ ] Verify the loader's marker header, required log field, auth overlay and measured failures. Keep history outside ordinary visit fakes until D consumes it.
- [ ] Complete independent review, exact-tip CI/browser/queue and measured merge. Record the known listing-at-served-ref limitation as accepted, not a newly fixed historical listing service.

### Task 5: C1 — prescan before the sole HTML parser

**Create:** `pwa/src/docs/mockup/prescan.ts`, `parse.ts`, `pwa/test/mockup-prescan.test.ts`, `mockup-parse.test.ts`, `pwa/browser/mockup-parse.browser.test.ts`.
**Modify:** `pwa/test/docs-scans.test.ts` (one parser allowance with its own evasion controls).

**Interfaces:**

```ts
type MockupPrescan =
  | { ok: true; depth: number; tags: number; formatting: number }
  | { ok: false; why: 'too-deep' | 'too-many-tags' | 'too-many-formatting';
      depth: number; tags: number; formatting: number };
function prescanMockup(text: string): MockupPrescan;
function parseMockup(text: string):
  | { ok: true; doc: Document; prescan: MockupPrescan }
  | { ok: false; prescan: MockupPrescan };
```

- [ ] RED: depth 256 accepted and 257 refused; formatting opens cannot be cancelled by unrelated closes; quotes/comments/raw text cannot hide counted dangerous shapes; refusal means parser constructor call count zero. Add independently planted escaped/aliased constructor controls to the source scan.
- [ ] Run `mockup-prescan`, `mockup-parse`, `docs-scans`; record real assertion failures before adding the exports.
- [ ] Implement one linear conservative scan. Keep the sole `new DOMParser(` in parse.ts and call prescan first. No browser DOMParser constructor exists in prescan.ts; it has no DOM/I/O import.
- [ ] Run bounded synthetic formatting-reconstruction measurement first, fix `MOCKUP_MAX_OPEN_FORMATTING`, then measure/fix `MOCKUP_MAX_TAGS`; depth remains 256. Each admitted deep/formatting worst case ≤1000 ms in the browser, maximum input 2 MiB, no more than 12 generated fixtures, no repository copies. Record exact engine/build/limits and test both boundary sides.
- [ ] GREEN plus mutations: bypass prescan; ignore formatting count; allow depth 257; add a second parser at each allowed/evasion site. Each must produce its own red. Commit the parser, measured constants, tests and scan entry.

### Task 6: C1 — one asset plan with explicit pin/failure distinctions

**Create:** `pwa/src/docs/mockup/plan.ts`, `ports.ts`, `pwa/test/mockup-plan.test.ts`.
**Modify:** `pwa/src/docs/DocImage.tsx`, `pwa/src/docs/reader/images.ts` only where shared pin decisions are extracted/reused; `pwa/test/docs-images.test.tsx` if that exact suite exists at dispatch, otherwise add `pwa/test/docs-asset-plan.test.ts` without renaming an existing suite.

**Interfaces:** `MockupContext = {readonly project: string; readonly pin: DocPin; readonly tree: DocsTreeOk}`. `MockupRef = {readonly key: string; readonly raw: string; readonly basePath: string; readonly kind: 'image' | 'css' | 'script' | 'module' | 'font'; readonly depth: number}`. Unique key is the DOM/discovery-order identity, not a URL to fetch directly. `MockupRefVerdict` is the base spec §5.6.3's full union (`inline/kept/external/refused/missing/unsupported/skipped/failed`), copied without collapsing reasons. `MockupSize = {readonly kind: 'listed' | 'class-cap'; readonly bytes: number}`. `MockupAssetPlan = {readonly rows: readonly {ref: MockupRef; verdict: MockupRefVerdict; size: MockupSize | null}[]; readonly reservedBytes: number}`. At admission a non-inline row has size null; an inline row has size and its base-union `size` is that admission reservation, not a claimed measurement. Loading may change an admitted row to failed while retaining its non-null reservation basis; reservedBytes never shrinks. The returned assets map contains successful bytes only, and actualBytes counts all completed unique replies, including rejected overflows, independently of admission. This typed basis prevents an unknown historical size collapsing into a tip measurement.

```ts
function planMockupAssets(refs: readonly MockupRef[], ctx: MockupContext): MockupAssetPlan;
interface MockupAssetReader {
  read(pin: DocPin, signal: AbortSignal): Promise<
    | { kind: 'ok'; bytes: Uint8Array<ArrayBuffer> }
    | { kind: 'failed'; failure: string }>;
}
```

The adapter supplies existing Docs loaders/queue/auth; no new HTTP client. The planner calls existing `resolveDocRef`/`imagePinFor` semantics, never a second path grammar. For historical C different from `tree.ref.commit`, the served listing still decides eligibility under W5b, but its size is not C's size: reserve the full existing class cap before fetch, including nested CSS discoveries. Same-pin committed/draft listing sizes may be used only when tied to that exact admitted pin/fingerprint. Reservations never shrink/recycle during that plan, duplicate pins reserve once, and a reservation that would exceed 5 MiB yields skipped/over-budget with zero fetch. The UI discloses conservative historical admission. Amend the base spec §5.6.3 Budgets and its inline size/basis contract to this exact rule in C1; this is the explicitly labelled coordinator design call, not an unrecorded exception to 'all listed sizes'. Claim `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` for that narrow amendment and define the issued departure at C1 run-open.

- [ ] RED table: committed C with modified draft asset reads C; admitted draft modification/addition/untracked/conflict gets DraftPin; deleted/withheld/typechange is missing/refused, no committed fallback; max64 and max5MiB stop before fetch; duplicate reference budgeted once; CSS depth3 admitted/4 unsupported; unknown MIME refused by extension table.
- [ ] Run `mockup-plan` and image-policy suites to assertion-red. Implement the pure deterministic planner with exact-pin listed sizes or historical class-cap reservations. RED historical cases use the same tip listing with both smaller and larger C bytes: admission is identical and never trusts the tip size; two fitting class-cap reservations and the next over-budget row have explicit ordered verdicts, CSS discoveries share the same nonrecycled budget, and no historical metadata endpoint is called. Keep count and byte boundaries inclusive as the base spec defines; reader seed limits remain separate.
- [ ] GREEN and rows independently removing pin distinction, prefetch size gate, count/total reservation budget, historical class-cap basis (replace it with the misleading tip size), CSS depth and MIME check. Assert reader/plain paths use the same decisions, not identical output when their seed limits differ. Commit.

### Task 7: C1 — bounded loading, origins and policy

**Create:** `pwa/src/docs/mockup/load.ts`, `css.ts`, `origins.ts`, `policy.ts`, `pwa/test/mockup-load.test.ts`, `mockup-css.test.ts`, `mockup-policy.test.ts`.

**Interfaces:** `MockupAssetResult = {readonly plan: MockupAssetPlan; readonly actualBytes: number; readonly assets: ReadonlyMap<string, {readonly mime: string; readonly bytes: Uint8Array<ArrayBuffer>}>}`; `loadMockupAssets(plan, reader, signal): Promise<MockupAssetResult>` keeps failures in the returned plan. `HttpsOrigin` is an opaque branded string produced only by `parseMockupOrigin(raw: string, ownHostname: string): HttpsOrigin | null` (null means refused origin). `mockupCsp(extra: readonly HttpsOrigin[]): string`. `buildMockupSrcdoc(doc: Document, assets: MockupAssetResult, extra: readonly HttpsOrigin[], scripted: boolean): string` serialises the already parsed document, CSP first and guard second. The DOM extractor in css/load is an adapter, not a claim that DOM code is L1.

- [ ] RED loader: concurrency peak2; abort stops new fetches; duplicate loads once; first mutable latest/draft pin movement relists/replans once, second is failed/changing with manual retry; unavailable historical commit fails directly with zero relists and no switch to latest; 401 stays failed/auth, not missing. Actual bytes above the reservation or class cap are failed/size-mismatch and never inlined; successful actual counts are reported separately from reservedBytes, not overwritten as a tip-sized measurement. Add RED for actual-size overflow, conservative skipped rows, and no reuse of a smaller historical reply's reservation. Record the relist callback at the view layer, not hidden retry inside each asset.
- [ ] RED origins/CSS: exact HTTPS only; reject IP, localhost and *.localhost, current hostname at any port, whitespace, semicolon, quotes and wildcard; lexical script-text census never offers truncated origin and never fetches; CSS recursion/cycle and budget failures stay explicit.
- [ ] Run `mockup-load`, `mockup-css`, `mockup-policy` to assertion-red. Implement via the screen's existing queue/loaders and fixed extension MIME. Confirmed origins append only script/style/img/font; never connect/default/worker/frame. No author consent stored across views.
- [ ] GREEN and mutations: concurrency3, relist twice, auth→missing, omit actual-size/reservation check, prefix-host accept, same-host-other-port accept, connect-src widening, meta after author bytes, CSP attribute mismatch. Commit C1; use Task 10's common PR/review gate before C2 starts.

### Task 8: C2 — mockup viewer and reader image integration

**Create:** `pwa/src/docs/MockupView.tsx`, `MockupFrame.tsx`, `pwa/test/mockup-view.test.tsx`, `pwa/browser/docs-mockup.browser.test.ts`.
**Modify:** `pwa/src/docs/DocsLeaf.tsx` at `HtmlStandIn`; `DocsHead.tsx`, `docsText.ts`, `docs.css`, `DocImage.tsx`, `ReaderFrame.tsx`, `reader/images.ts`; affected control/tap/contrast/markup/ring/worker scans.

**Interfaces:** `MockupViewProps = {readonly show: DocsShowOk; readonly context: MockupContext; readonly reader: MockupAssetReader}`. It consumes Tasks5–7 and produces the existing leaf Export publication plus a mockup source for Task9. `MockupFrameProps = {readonly srcdoc: string; readonly scripted: boolean; readonly title: string; onNavigated(): void}`. Its React key is mode+nonce, not author text.

- [ ] RED: HTML leaf mounts viewer; >1MiB requires tap and >2MiB is download-only; refusal Source/Download, no Render anyway; reset script/origin choices on doc/mode change; draft and omitted assets truth; normal stop destroys frame; second load notices/tears down and never remounts automatically.
- [ ] RED reader assets: failed401 is visible and retryable after sign-in; old body abort cannot publish data/draft counts into new body; overlong seed/ref returns a controlled fallback rather than a whole-page exception. Keep stricter reader limits and existing per-screen queue.
- [ ] Run unit cases then implement viewer using existing header, 70dvh frame and white-canvas token, Run/Stop/Load external/Fullscreen/New tab/Source/Download. Fullscreen and new tab navigate to the console's existing full-frame shell; never raw active bytes or author URL. Source uses one CodeBlock/store, plain first; Download original bytes.
- [ ] GREEN real browser: empty sandbox vs exactly allow-scripts, no src/name/allow/allowfullscreen, no frame-origin cookie/storage, no parent messages, no popup/top-nav, meta-only policy independent of csp attribute, second-load teardown. Compare app chrome/cross-width controls and full existing browser suite for navigation regressions.
- [ ] Measure independent mutations for sandbox, second-load teardown, meta-only control, source-store path, draft state reset, auth retry and stale body. Commit.

### Task 9: C2 — static mockup Export through existing Save

**Create:** `pwa/src/docs/mockup/exportMockup.ts`, `pwa/test/mockup-export.test.ts`, `pwa/browser/docs-mockup-export.browser.test.ts`.
**Modify:** existing `pwa/src/docs/export/{exportInput.ts,buildExport.ts,exportAssets.ts,policy.ts}` as required by actual exports; `ExportSheet.tsx`, `DocsHead.tsx`, `exportBody.ts`, `objectUrls.ts` only for the typed new arm. There is no existing `export/ports.ts`; do not invent one as a dependency.

**Interfaces:** add a discriminated `mockup` arm to the actual `ExportSource`/`ExportBody` unions, carrying `{pin, show, doc, assets}` from the inert plan. `buildMockupSnapshot(doc: Document, assets: MockupAssetResult): {readonly html: string; readonly links: readonly string[]; readonly omitted: readonly string[]}`. Extend `exportInputOf(ExportRequest, {exportedAt, theme})` using that arm; preserve existing call signatures and synchronous `downloadExport({name, bytes})` save path. No parallel Export builder or second parser.

- [ ] RED structural cases: remove scripts/frames/objects/embed/base/http-equiv meta/template and unsafe links/attributes; unwrap noscript; strip SMIL href animation; no drawn/script output/consent retained; CSS neutralisation limitations disclosed; link table inert and escaped; refused prescan exports source text.
- [ ] RED budget/gesture: cap is final escaped bytes; DOM-order placeholder replacement; draft and hidden assets listed; draft confirm completes before the Save gesture; octet-stream, not active HTML blob. Browser asserts a usable file and no app-origin execution.
- [ ] Run `mockup-export`, existing `docs-export`, `docs-export-policy` if present, and new browser file to assertion-red. Implement by cloning parsed document, existing provenance wrapper and CSP-first empty-sandbox inner frame. Keep original-byte Download distinct.
- [ ] GREEN and independent rows: omit sandbox, retain script/on*/external URL, omit draft warning, pre-escape size test, unsafe MIME, second parser allowance. Existing Export suites and browser files stay green. Commit.

### Task 10: Close each C PR with security/browser evidence

**Files:** this plan's C Results/task notes; source scans/censuses where new owners require explicit entries. No broad scan or ring exemption.

- [ ] C1 close: Tasks5–7 units/typecheck/current source scans, guard mutation table, bounded parse evidence, independent exact-tip review. C2 close: Tasks8–9 plus whole PWA/browser suite and related server/agent guard suites. For each added allowance plant its own evasion control; retain W8a's current three-worker allowances.
- [ ] Map base lab rows1–4,6,7,10 and E1/E3–E13 (there is no E2) to actual evidence. Map M5.7 mockup half, M5.8–16, M5.19, M5.21–22, M5.EX1–EX7 and browser M5.B1–B4/B7/B8/B10/B11. Every row is measured, existing evidence at the current tip, or explicitly blocked; no implied jsdom proof of CSP.
- [ ] Run synthetic CDN-module diagram fixture in a desktop browser and released-build phone stage. If policy blocks it, keep source and truthful note, never broaden CSP. Shared-thread phone evidence selects scripts-confirm when required; file/activation evidence selects the already specified export contingencies and gets its regression test.
- [ ] Record sequential mutation restore hashes and actual reds; run affected full packages, typechecks, rings/censuses/control/contrast/built-reader and complete browser suite. Read complete exact-head CI, then separate review and queue. Record MERGED before next unit/close. Operator-only device rows not yet measured remain explicitly open for Task17, not claimed passed here.

### Task 11: D — bounded client diff

**Create:** `pwa/src/docs/reader/diff.ts`, `pwa/test/reader-diff.test.ts`.

**Interfaces:** pure L1, no library/DOM/worker/api imports.

```ts
type ReaderDiff =
  | { kind: 'available'; ranges: readonly (readonly [number, number])[];
      removedAfter: readonly number[] }
  | { kind: 'unavailable'; why: 'bytes' | 'lines' | 'work' | 'output' };
function readerDiff(before: string, after: string): ReaderDiff;
```

Line numbers are 1-based in **after**, ranges inclusive and sorted/nonoverlapping. A deletion is marked after the preceding surviving line; 0 means before the first line. Empty identical strings yield no ranges/removals. Treat CRLF as one separator, retain final-empty-line semantics consistently with `data-line`; a test renders the real parser to hold that mapping. Released 1.1.0's `src/enhance/changes.ts` explicitly accepts removedAfter 0 at the start. Pin that behaviour with the real library, including an empty after document; do not invent a new unsupported-position failure or manufacture a different mark.

- [ ] RED table as assertions: identical→empty; insertion after line1→range[2,2]; deletion before first→removedAfter[0]; replace line2→range[2,2] plus the deletion marker according to the real library rendering contract; CRLF/LF and final newline; Unicode text; 20,001 lines→unavailable lines; exhausted comparisons→unavailable work; >512 output marks→unavailable output. Use 513 isolated single-line insertions separated by unique stable lines; measure that the 2,000,000 work cap is not exhausted so removing the output guard alone yields available and reds this assertion. Keep a separate fixture for work exhaustion.
- [ ] Run `reader-diff`; record failures before implementation. Implement prefix/suffix trimming and budgeted Myers, shared work counter ≤2,000,000 including line comparisons, frontier advances and copied trace cells, no quadratic matrix, no unbounded fallback. Use existing UTF-8 byte measurement/cap, do not enumerate another cap constant.
- [ ] GREEN plus a deterministic reference oracle on small fixtures and symmetry/reconstruction checks (bounded fixed seed). Add mutations removing each bytes/lines/work/output guard and changing line-origin/CRLF semantics. Record finite wall-clock/process bounds without a disk benchmark. Commit.

### Task 12: D — history seed, changes adapter and version state

**Create:** `pwa/src/docs/reader/history.ts` (pure seed/navigation decisions), `pwa/src/docs/readerHistory.ts` (view-owned lifecycle), `pwa/test/reader-history.test.ts`, `reader-history-adapter.test.tsx`, `reader-history-types.test-d.ts`, `pwa/browser/reader-history.browser.test.ts`.
**Modify:** `reader/bridge.ts`, `reader/policy.ts`, `ReaderFrame.tsx`, `DocsLeaf.tsx`, `useDocsVisit.ts`, `docsLinks.ts` only for the planned adapters/visit state; current docs/reader scans and adapter-key tests.

**Interfaces:**

```ts
interface ReaderCommit {
  readonly sha: string; readonly subject: string; readonly date: string;
  readonly parents: readonly string[];
}
interface ReaderVersionSeed {
  readonly sha: string; readonly draft: boolean;
  readonly commits: readonly ReaderCommit[] | null; readonly only: string | null;
}
function readerVersionSeed(sha: string, draft: boolean,
  log: DocsLogOk | null, only: string | null): ReaderVersionSeed | null;
```

Here log null means history unavailable, seed null means invalid full served hash, commits null means no history supplied, only null means no day filter. Types are type-only imports from shared; no library import here. Map `DocsLogEntry.parent` to [] or [parent]; omit author, bound subject to200 UTF-16 units/date64, commits100/parents16. `only` must be a full hash admitted by the supplied entries **or their parent hashes**, otherwise null. The released day menu uses the oldest day's parent as its baseline, which may not itself appear as an entry; retain that valid boundary case. Never silently cut a malformed hash into validity.

Add optional callbacks/seed to `ReaderMountInput`: `version?: ReaderVersionSeed`, `changes?: (sha: string) => Promise<{ranges: readonly (readonly [number, number])[]; removedAfter?: readonly number[]} | null>`, `openVersion?: (v: {sha?: string; only?: string}) => void`. Bridge is the only runtime library host import, type-test both directions against `HostAdapters`. Replace `withServedVersion`'s history stripping only for validated D input; lab mounts remain history-free.

- [ ] RED pure cases: full40/64 hashes, invalid/short/inherited fields refused, root parent[], subject surrogate boundary/date limits,100 commits, absent/truncated/error history is not fabricated complete, oldest-day parent baseline accepted even when absent from entry SHAs, `only` outside both entries and parent hashes is ignored. Run `reader-history`.
- [ ] RED integration: B2 `DocsHistoryLoader.history(project, ask)` with opened committed pin; two committed file reads for changes, current and baseline, never draft bytes; stale/aborted response returns null and cannot affect replacement. Failure/no text/overflow→unavailable, no empty-success marks. Use existing loaders/auth/lane, no new endpoint/cache/exec verb.
- [ ] RED navigation/state: sha→at while ref survives; no sha→latest; only in visit history.state with popstate/reload tests, never URL; version body links retain version; blocked storage leaves reading usable; mark/last visit remain device/doc scoped under existing prefix. No migration or new storage owner.
- [ ] Implement `readerHistory.ts` lifecycle with body-key generation and cleanup; assemble optional seed before mount, callbacks close over that body's immutable pins. Use `readerDiff` and actual rendered `data-line`. Preserve one-bar ready/withdraw/commands and production on-request. Type-test callback keys/census, no handwritten protocol parser.
- [ ] GREEN unit/type/browser suite with actual library: menu, changes and removal marks, unavailable and draft notes, Back latest/ref, only/day Back/Forward, marks/last visit/prefs across visit, late read after teardown. Mutate generation check, committed-pin selection, adapter forwarding, only URL exclusion, prefix and off-list/hash guards independently. Commit.

### Task 13: D — close reader, lab and header evidence residue

**Modify:** `ReaderFrame.tsx`, `reader/policy.ts`, `docsLinks.ts`, `reader/bridge.ts` and their existing tests; `pwa/browser/reader-frame.browser.test.ts`, `reader-lab.browser.test.ts`; `pwa/test/reader-lab-run.test.ts`, `reader-lab-verdicts.test.ts`, source scans; narrow `pwa/src/readerLab/run.ts`, `verdicts.ts` and RL-a files only after current ownership/claim check. The coordinator owns historical plan/ledger corrections separately.

- [ ] RED real symptom: post-mount fallback consumes the correct fragment in the plain view; same-page filename+fragment scrolls without a needless new body fetch; overlong/refused image seed safely falls back. Actual-library hidden-character copy opens the confirmation sheet before clipboard write. Replace ineffective hash browser fixture with a target whose position proves scrolling.
- [ ] RED policy ring: dependency walk of reader policy imports no hook/tsx runtime. Extract only the shared pure link decision from docsLinks if needed, keep one grammar and type-only view imports; no test exception widening. Inspect error-name duplication and worker load-failure timeout: retain existing guard if measured or add a failing test before repair.
- [ ] RED lab controls: observe scroll before append (append cannot hide lost scroll); busy-frame0.8 boundary row fails when factor mutated; meta-only and stray-message controls trigger their sinks independently. Use event counters/observable condition and a bounded deadline, not a fixed-delay “nothing happened”. Do not change the historical auto/window instrument to obtain a pass.
- [ ] Run related reader/lab/link suites to assertion-red, implement minimal fixes, rerun. Preserve E18's unmeasured iframe and store/listener coverage limits unless a newly effective probe actually measures them. No widened hidden-character vocabulary unless already accepted/library-supported.
- [ ] Measure each named mutation separately, restore/hash-check, commit by finding. Correct RL-a comments/scanner and header count/wording only from shipped-source and actual results. Historical reds are not rewritten as if remeasured.

### Task 14: Close D and reconcile its carries

- [ ] D Tasks11–13: full PWA unit/type/built/browser suites, related server rings/census/storage scans, every end-state mutation. Add actual-library browser rows rather than faking host callbacks alone.
- [ ] Update CarryReceipt rows owned by C/D with exact merge/test evidence. Record library C114's two missing mutation rows and text/evidence corrections as library-owner maintenance, not proved consumer defects; do not require an invented 1.1.x release to finish D.
- [ ] Separate review run with held-out panel, verified fingerprint, complete exact-tip CI and protected queue. Carry every surviving finding with severity/owner; critical/important are fixed or returned, never silently listed as advisory.
- [ ] Record actual merge and successor E before closing D. Device evidence still belongs to Task17.

### Task 15: E — finite carry closure and source-backed documentation

**Modify:** `README.md`; project `CLAUDE.md` (Docs preview/caps wording only, **not the box-token bullet**); `server/src/docs/policy.ts` at duplicated `lowerAscii`; `server/test/docs-source.test.ts`; current scan/tests owning the CarryReceipt; `ccd/ccrc`, `ccd/ccrc-doctor-checks`, `deploy/account-op.mjs` only where current citations/prose require it. Claim exact additional files before any subagent edits. No global instructions or deployment config edits.

- [ ] Read latest source and later closure notes for every remaining design §7 group: W2 widening arms/four evasions; W3 generation map/key redaction/JSON parse/lowerAscii; W4 review412/nesting/alias/hook/count/r10/r11; Share cancellation; Export direct assertions/rawquote; W5h-b text; compression actual-config emptyOutDir/Node pin/both-order next-touch. Attach exact existing evidence for already-fixed/accepted rows. A mere old Later sentence is not a new defect.
- [ ] Privately verify the SEC-3/SEC-4/post-fetch/branch:null/partial-clone/stripped-byte/U5 historical status and owner before public reporting. Reproduce only in bounded fixtures. Any surviving reachable security defect gets a narrowly scoped test-first worker task and independent security review before E closes; no exploit detail in a public ledger before safe disposition. This is verification of named obligations, not an unbounded fresh audit.
- [ ] For each surviving code defect, add a named reproduction in its owning suite first, record expected red, implement only the claimed fix, green and independently mutate the guard. For W2 add independent rows for both allowances and all four evasion spellings. For lowerAscii reuse the existing pure source of truth, no second enumeration. For compression test actual build config rather than a duplicate fixture; never ship compressed shell without the guard.
- [ ] Update README from shipped source: all six sections, page/API grammar, ref/at/only, draft/provenance/skew/failures/auth/offline, reader/mockup safety, Source/Download/Share/Export, settings/state, limitations, versioned migration and retirement. Recut every test-pinned citation by content; do not reuse old line numbers. Correct W8-before-W7 ordering in current spec prose without rewriting historical evidence.
- [ ] Update project CLAUDE's applicable Docs/caps/preview/flake wording and measured citations in the named ccd/deploy docs readers. Leave box-token doors and unrelated safety clauses unchanged. Run docs-parity/citations/box-token-census/session-hook/rings and source scans, `GROWTH_CHECK=1` if a listed file grows, deviation-refs after local commit and fresh origin/main. Record actual rc/counts.
- [ ] CarryReceipt must have zero open/unclassified rows at close: fixed, already-fixed, accepted/deferred with an existing ruling+owner+trigger, or blocked. A blocked row stops acceptance. Explicit non-goals retain truthful not-delivered wording. Commit source fixes by finding and docs by coherent topic.

### Task 16: E — independent whole-programme review and release candidate

**Owner:** coordinator plus separately dispatched reviewer. Worker internal reviews are not this gate.

- [ ] Freeze candidate tip/base and review all remaining-programme PRs plus interaction paths on that exact tree. Use three Opus/high held-out lenses: correctness; spec/security boundaries; reproduction/evidence. Critical/important each receive three Sonnet/high refuters and majority ruling, minor one/advisory. Record actual model/effort; missing/dead lens is unverified. No workflow unless separately authorised.
- [ ] Verify fingerprint through the server before review, close review with its accepted report, preserve cited report before review-child reclamation. Tip movement means remeasure/review, never accept a stale report. The coordinator does not replace this with its own diff reading.
- [ ] Resolve every blocking finding with red/green and measured guard row, one fix commit; rerun affected/full gates and fresh exact-tip review as required. Complete changed-file/outward-text scan; no unissued deviation definitions.
- [ ] Read full exact-tip check pagination, required CodeQL check itself, actual browser steps and newest run per suite. PR-selected CI is not full-suite proof. Queue with exact-head binding, no admin/squash/update-branch, and measure actual MERGED. Mail MERGED before final close, successor run first.
- [ ] Produce candidate receipt with merged commit/release mapping and a trusted full-suite on the exact intended release commit, including real browser execution. Request a full trusted run through the existing release gate if absent; do not pass on skipped/selected/sampled checks. No stable promotion or tag action invented by the coordinator.

### Task 17: F — release, rollout, installed-build acceptance and handover

**Files:** programme ledger plus this plan's Results; no infrastructure mutation from a feature worker.

**Interfaces:** evidence rows carry `{capability, releaseTag, commit, installedBuild, engineOrBox, action, observed, coverageLimit, timestamp, verdict}`. Private coordinates/device details remain private; public rows use neutral roles. Verdict is pass/fail/unmeasured, never inferred.

- [ ] Measure the actual existing release, attestation and trusted full-suite. Pin one tag/commit for the acceptance set. Prepare the exact operator rollout item; first tag containing B1 uses server-first. This coordinator monitors the existing update mechanism read-only and does not manually roll out or promote without operator go.
- [ ] After operator action, remeasure both installed stamps/provenance/health and capabilities. Fleet doctor docs PASS and server docs-sw PASS must be actual output, not a peer's unverified claim. Exit3 means installed but doctor unhealthy; exit4 means restored/stop. Record both truthfully.
- [ ] Verify actual PWA/service-worker build equals the release. Desktop deployed acceptance: six sections, ref/draft/auth failures, history/version links/at/ref/only/Back latest, changes/unavailable/draft, prefs/marks/last visit, source/download, Share/Export, mockup static/scripted/external reset and second-load refusal. A content title/pin check proves native docs, HTTP200 alone does not.
- [ ] Prepare one concise device item for real-only rows: one-bar and reachable tools at412×915, on-request figures, released-build lab E17/E18, synthetic mockup/script risk, iOS browser+installed Save, Android Share/Copy/Export usable file, desktop Firefox static export. Reuse existing phone blocks only as historical evidence, never as this build's result. No request to repeat old evidence merely for paperwork.
- [ ] Apply already specified scripts-confirm/export-flat/share-file contingency if its trigger is measured; return a code defect to a scoped worker/review cycle, then repeat affected acceptance on the new release. Do not discard a failing phone block or widen CSP to get a pass.
- [ ] Commit final handover: actual shipped features, exact evidence, limitations, CarryReceipt with zero blocking/unclassified rows, operator-only retirement pending if applicable, rollback route. Report “native delivery verified” only when every mandatory row passes or has an existing explicit accepted outcome. Keep programme open for a mandatory retirement gate; no false whole-programme closure.

### Task 18: Separate operator retirement and final programme closure

**Owner:** operator for each infrastructure act; coordinator prepares and verifies receipt. This is not permission to touch live docserver units/config, proxy mappings or project roots.

- [ ] Recheck retirement prerequisites: F verified, six sections including vision/promise, all roots safely under projects root, no active session working in a root being moved, required docs/doctor/docs-sw and phone evidence. If any fails, native preview and standalone remain separate and programme says pending.
- [ ] Operator sequence: denylist condition; safe Git-root moves; remove old `/docs` proxy mapping on every PWA origin **before** any stop; prove native content/ref/draft/auth; update operator preview convention (durable GitHub links unchanged); stop forwarder; stop old docserver, retain history/directory; prove listener closed.
- [ ] Verify outcome without printing private config/secrets. Rollback never serves raw standalone HTML on authenticated app origin. If cutover fails, record exact boundary and keep a safe separately authenticated preview; no hidden infrastructure workaround.
- [ ] With final receipts committed and all required run/item states measured, mail MERGED/closure before closing the last run. Clear coordinator intent only when the role ends. Final response distinguishes native delivery from standalone retirement, with no “complete” claim ahead of evidence.

## Per-wave brief and acceptance contract

Each dispatch includes only wave specifics: programme/spec/plan paths; exact task range and actual base; allowed files and overlapping-claim agreement; produced/consumed interfaces; existing approvals and evidence applicable to that wave; issued deviation block and defined departures; chrome/test routing; required mutation/browser/device rows; branch-discipline sentence; stop conditions. Do not paste the standing worker skill.

**Routing:** main worker Opus; native Sonnet/medium implementers, Sonnet/high for the bounded parser/asset/diff/adapter tasks5–7/9/11–12; per-task Opus/high reviewers for untrusted-input/boundary tasks and Sonnet/medium for mechanical documentation tasks. Every Agent call names model and required effort literally; never Fable. Workflow mode off. External reviewer uses the held-out contract in Tasks16/design §8, never the older single-refuter shortcut in historical plan text.

**Acceptance:** remeasure wave-done, server-verify fingerprint, separate review run, accepted report, exact-head required PR/queue checks, actual MERGED. Feature worker does not merge their own PR; coordinator ledger work stays on ledger branches. Open successor before closing predecessor; report copies survive child reclamation. No child wait hidden behind a long coordinator workflow or poll loop.

## Deviations found

No new deviation number is defined by this documentation-only plan. At each implementation run opening the coordinator allocates and defines its known departures in the ledger in the same act. The historical class-cap asset reservations (including the base spec's listed-size amendment), conservative diff limits and serial C/D decomposition are labelled coordinator calls, not historical operator rulings. A departure from an existing normative sentence gets an issued entry before dispatch, not a guessed number.

## Results

Not executed. This section will link exact run/task receipts, carry table, red/green and end-state mutation results, independent review reports, exact-tip CI/queue/full-suite evidence, release/inventory/device matrix, and separate cutover receipt. Publication of this plan alone fills none of those boxes.

## Where things stand

### Agreed

- One remaining delivery line in this programme; reuse approved choices and both phone blocks.
- A includes real Settings access; B keeps its approved two-run split; W7 is last.
- Implementation, review, landing, release, installed evidence and retirement are distinct facts.

### Waiting on you

- No repeated approval/signing/phone-evidence request. Reserved rollout, device and retirement actions become precise console items when ready; all unblocked work proceeds autonomously.

### Later

- Only the design §7 explicit accepted/deferred/non-goal rows. No unowned “follow-up” may be used to erase a required delivery task.
