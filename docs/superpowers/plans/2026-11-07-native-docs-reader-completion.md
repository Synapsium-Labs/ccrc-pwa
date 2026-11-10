# Native Docs reader — remaining delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task, under the dispatched `ccrc-worker` role. This is one programme with serial work/review runs, not permission for one worker to execute every wave. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish native Docs delivery through installed-build verification and an honest handover, preserving the separate operator-only standalone retirement gate.

**Architecture:** Reuse the approved take-up and W5b leaf plans. W6 adds a bounded mockup/asset pipeline separate from the sealed reader; W8b uses the existing history/version transport through the one library adapter and a pure bounded diff. W7 reconciles carries, documents the shipped source, runs independent review and records release/deployed evidence.

**Tech Stack:** TypeScript, React 19, Fastify, the existing ccd Python helper, package-local vitest, existing browser harness, `@synapsium-labs/docserver` exactly 1.1.0 for A–D (later extension pins require their own review), existing parse/render and highlight workers. No new runtime dependency is authorised for A–D by this plan; required extensions need their own reviewed dependency and security decisions.

**Spec:** `docs/superpowers/specs/2026-11-07-native-docs-reader-completion-design.md`; base spec `2026-10-01-native-docs-reader-design.md` §5.6–5.8; rich-docs spec `2026-10-12-rich-docs-reader-and-shared-renderer-design.md` G1/G4/G5/G6/G7 and retirement gate. Read the spec with this plan.

**Status:** 2026-11-07 completion plan. No remaining implementation is claimed complete by this document. A uses planned run 1532; later run IDs and deviation blocks are issued at their actual opening, not invented here.

## Global Constraints

- A–D use exactly the released library `v1.1.0` at `50cef012aa671974473d19c2acd77f900e9d03af`; npm integrity is recorded in the take-up plan. Recheck provenance at execution; do not repeat signing/publication approval. This is not the final extension-release pin: any later library change needs its scoped extension design, compatibility checks and reviewed exact-version adoption; F measures the final approved release set.
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
- Required appearance continuity is a final E/F acceptance gate: separately specify, implement and review shared-renderer/consumer support for ccrc's canonical skin/theme catalogue and host-selected visual language. A remains exact 1.1.0; API, catalogue-sharing and compatibility are not approved by this scope record.
- Recorded operator ruling #1418 keeps outside non-repo folders, variants, large files, PDFs and configured tracker links; #1420 requires private draft-review snapshots with a lifecycle. Full parity plus drafts and side-by-side installed evidence gate final E/F acceptance and retirement. Outside folders need not become Git repositories. These are required follow-ons with scoped designs/leaf plans, not Later/Dropped or work silently assigned to A.
- Existing per-read/render safety limits remain until a reviewed parity-extension design replaces them. No unsafe blanket cap increase, unauthenticated working-tree read or sandbox/CSP widening is authorised here.

**Parity inventory reconciliation:** #1418's no-feature-loss promise is not limited to its five named examples. The required follow-on spec must inventory the standalone reader's capabilities against the native reader, including print and figure-overlay Back-to-close, and amend the rich-docs parity table before E closes. Those rows are not automatically waived by their older Later/Dropped labels. Old-origin state currently starts fresh under the rich-docs state contract; reconcile that recorded choice with the later no-feature-loss promise explicitly, without authorising migration here. Any genuine conflict requiring a product waiver goes to the operator before E/F acceptance. Keep the current sandbox/CSP and state boundaries until a reviewed design or explicit ruling resolves the seam; do not add allow-modals or claim a missing capability delivered.

**Recorded draft decision:** #1420's 2026-10-25 operator comment fixes a frozen snapshot at share time, with 'newer draft available' and re-share after later edits; no live reads through the link. Do not re-ask that choice. Capability-link versus signed-in access, reviewer comments, revocation storage/retention and hidden referenced assets still need the scoped threat model/design; the no-session acceptance criterion must be reconciled with the access model, not silently discarded. Raise only genuinely unresolved product choices when their design needs them. Comments, if adopted, never count as merge approval.

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
| Required follow-ons | Separate scoped leaf plans, after A and before final E/F acceptance | Native appearance continuity; #1418 parity and #1420 draft lifecycle | New ownership/claims and reviewed interfaces required; not in A's scope |
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

**Interfaces:** `MockupContext = {readonly project: string; readonly pin: DocPin; readonly tree: DocsTreeOk}`. `MockupRef = {readonly key: string; readonly raw: string; readonly basePath: string; readonly kind: 'image' | 'css' | 'script' | 'module' | 'font'; readonly depth: number}`. Unique key is the DOM/discovery-order identity, not a URL to fetch directly. `MockupRefVerdict` is the base spec §5.6.3's full union (`inline/kept/external/refused/missing/unsupported/skipped/failed`), copied without collapsing reasons. `MockupSize = {readonly kind: 'listed' | 'class-cap'; readonly bytes: number}`. `MockupAssetPlan = {readonly context: MockupContext; readonly rows: readonly {ref: MockupRef; verdict: MockupRefVerdict; size: MockupSize | null}[]; readonly reservedBytes: number}`. At admission a non-inline row has size null; an inline row has size and its base-union `size` is that admission reservation, not a claimed measurement. Loading may change an admitted row to failed while retaining its non-null reservation basis; reservedBytes never shrinks. The returned assets map contains successful bytes only, and actualBytes counts all completed unique replies, including rejected overflows, independently of admission. This typed basis prevents an unknown historical size collapsing into a tip measurement.

```ts
function planMockupAssets(refs: readonly MockupRef[], ctx: MockupContext): MockupAssetPlan;
function extendMockupAssetPlan(plan: MockupAssetPlan, refs: readonly MockupRef[]): MockupAssetPlan;
interface MockupAssetReader {
  read(pin: DocPin, signal: AbortSignal): Promise<
    | { kind: 'ok'; bytes: Uint8Array<ArrayBuffer> }
    | { kind: 'failed'; failure: string }>;
}
```

The plan retains its immutable context. `extendMockupAssetPlan` uses that same context and the existing rows/reservations: it resolves newly discovered CSS references relative to their parent stylesheet, applies identical listing/pin/MIME/depth rules, deduplicates against already admitted pins (including failed loads), and extends the same nonrecycled count/byte budget. Within one load attempt it never starts a second plan or resets reservations for nested CSS. A permitted whole-view retry is a distinct attempt, defined in Task 8; it discards the old attempt rather than extending or mixing its state. The loader feeds discoveries in deterministic parent-row then CSS-token order, not network completion order, buffering out-of-order completions as needed; concurrency remains two. For references discovered at the same depth from the same parent stylesheet, their token occurrence order within that stylesheet is the tie-break (including import, image and font references); no completion-time or asset-kind reordering. No transport adapter receives admission-policy authority.

The adapter supplies existing Docs loaders/queue/auth; no new HTTP client. The planner calls existing `resolveDocRef`/`imagePinFor` semantics, never a second path grammar. For historical C different from `tree.ref.commit`, the served listing still decides eligibility under W5b, but its size is not C's size: reserve the full existing class cap before fetch, including nested CSS discoveries. Same-pin committed/draft listing sizes may be used only when tied to that exact admitted pin/fingerprint. Reservations never shrink/recycle during that plan, duplicate pins reserve once, and a reservation that would exceed 5 MiB yields skipped/over-budget with zero fetch. The UI discloses conservative historical admission. Amend the base spec §5.6.3 Budgets and its inline size/basis contract to this exact rule in C1; this is the explicitly labelled coordinator design call, not an unrecorded exception to 'all listed sizes'. Claim `docs/superpowers/specs/2026-10-01-native-docs-reader-design.md` for that narrow amendment and define the issued departure at C1 run-open.

- [ ] RED table: committed C with modified draft asset reads C; admitted draft modification/addition/untracked/conflict gets DraftPin; deleted/withheld/typechange is missing/refused, no committed fallback; max64 and max5MiB stop before fetch; duplicate reference budgeted once; CSS depth3 admitted/4 unsupported; unknown MIME refused by extension table.
- [ ] Run `mockup-plan` and image-policy suites to assertion-red. Implement the pure deterministic planner with exact-pin listed sizes or historical class-cap reservations. RED historical cases use the same tip listing with both smaller and larger C bytes: admission is identical and never trusts the tip size; two fitting class-cap reservations and the next over-budget row have explicit ordered verdicts, CSS discoveries share the same nonrecycled budget, and no historical metadata endpoint is called. Keep count and byte boundaries inclusive as the base spec defines; reader seed limits remain separate.
- [ ] RED nested admission: extend an already admitted plan and assert `extended.context === initial.context`; use conflicting listing/pin outcomes in two separately constructed contexts to prove each attempt uses its own captured context, not a global current listing. In one attempt, nested discoveries preserve prior rows, failed admitted pins and reservations. Isolate the 64-count boundary with small bytes well below 5 MiB, and the 5 MiB boundary with fewer than 64 rows; each refuses the next nested discovery with zero fetch. A failed admitted pin rediscovered in CSS remains one admitted identity/reservation.
- [ ] GREEN and rows independently removing pin distinction, prefetch size gate, count/total reservation budget, historical class-cap basis (replace it with the misleading tip size), CSS depth and MIME check. Additionally measure every nested-admission row below independently. Assert reader/plain paths use the same decisions, not identical output when their seed limits differ. Commit.

| id | file | one mutation | discriminating RED (prediction, measure at execution) |
|---|---|---|---|
| NDR-C1-T6-N1 | `mockup/plan.ts` | Reset the admitted count when extending for CSS | `mockup-plan`: root plus nested row 65 must be skipped; total bytes remain below the byte cap |
| NDR-C1-T6-N2 | `mockup/plan.ts` | Reset `reservedBytes` when extending for CSS | `mockup-plan`: nested row beyond aggregate 5 MiB must be skipped with fewer than 64 rows |
| NDR-C1-T6-N3 | `mockup/plan.ts` | Exclude failed admitted rows from extension deduplication | `mockup-plan`: failed root pin rediscovered in CSS has one row and one unchanged reservation |

These are implementation obligations, not measured reds. At C1 execution record exact unique old/new snippets, tests, assertion output and restored hashes in the task's machine-readable mutation fence; a compile error, timeout or green row is not a successful guard mutation.

### Task 7: C1 — bounded loading, origins and policy

**Create:** `pwa/src/docs/mockup/load.ts`, `css.ts`, `origins.ts`, `policy.ts`, `pwa/test/mockup-load.test.ts`, `mockup-css.test.ts`, `mockup-policy.test.ts`.

**Interfaces:** `MockupAssetResult = {readonly plan: MockupAssetPlan; readonly actualBytes: number; readonly assets: ReadonlyMap<string, {readonly mime: string; readonly bytes: Uint8Array<ArrayBuffer>}>}`; `loadMockupAssets(plan, reader, signal): Promise<MockupAssetResult>` keeps failures in the returned plan. `HttpsOrigin` is an opaque branded string produced only by `parseMockupOrigin(raw: string, ownHostname: string): HttpsOrigin | null` (null means refused origin). `mockupCsp(extra: readonly HttpsOrigin[]): string`. `buildMockupSrcdoc(doc: Document, assets: MockupAssetResult, extra: readonly HttpsOrigin[], scripted: boolean): string` serialises the already parsed document, CSP first and guard second. The DOM extractor in css/load is an adapter, not a claim that DOM code is L1.

- [ ] RED nested discovery: use actual CSS extraction plus loading, not a hand-fed mock discovery list. Root CSS rows P0/P1 both complete under concurrency two; reverse their completion order and assert identical admitted row/pin/reservation order. P0 contains valid `@import` first, then `@font-face { font-family: example; src: url("a.woff2") }`, then `.hero { background-image: url("a.png") }`: font before image at the same depth and parent. A second fixture reverses those two rule kinds. Assert stylesheet token occurrence order in both, so ascending or descending asset-kind sorting fails; import-before-image alone is not a discriminator. Assert exact-pin/listing/draft-withheld outcomes against the captured plan context and `result.plan.context === initial.context`. Duplicate pins across root and CSS load/reserve once even after failure; smaller/failed replies never recycle reservations; the next over-budget discovery has zero reads. Call `extendMockupAssetPlan` and retain its result. A mid-load whole-view relist/context swap is tested on the real viewer in Task 8, not simulated by passing a nonexistent second context to this API.
- [ ] RED loader: concurrency peak2; abort stops new fetches; duplicate loads once; pin movement is returned as its existing explicit failed/moved detail to the view, with zero relists or hidden per-asset retries inside `loadMockupAssets`. Unavailable historical commit fails directly with zero relists and no switch to latest; 401 stays failed/auth, not missing. Actual bytes above the reservation or class cap are failed/size-mismatch and never inlined; actualBytes counts all completed unique replies, including rejected overflow, separately from reservedBytes. Add RED for actual-size overflow, conservative skipped rows and no reuse of smaller/failed replies' reservations. Task 8 owns the one whole-view relist/replan and generation boundary.
- [ ] RED origins/CSS: exact HTTPS only; reject IP, localhost and *.localhost, current hostname at any port, whitespace, semicolon, quotes and wildcard; lexical script-text census never offers truncated origin and never fetches; CSS recursion/cycle and budget failures stay explicit.
- [ ] Run `mockup-load`, `mockup-css`, `mockup-policy` to assertion-red. Implement via the screen's existing queue/loaders and fixed extension MIME. Confirmed origins append only script/style/img/font; never connect/default/worker/frame. No author consent stored across views.
- [ ] GREEN and mutations: concurrency3, hidden per-asset retry, auth→missing, omit actual-size/reservation check, prefix-host accept, same-host-other-port accept, connect-src widening, meta after author bytes, CSP attribute mismatch. Measure every nested-loader row below independently. Commit C1; use Task 10's common PR/review gate before C2 starts.

| id | file | one mutation | discriminating RED (prediction, measure at execution) |
|---|---|---|---|
| NDR-C1-T7-N1 | `mockup/load.ts` | Feed discoveries in reply-completion order instead of parent-row order | `mockup-load`: reversed P0/P1 completion yields the same exact admitted order under a tight budget |
| NDR-C1-T7-N2 | `mockup/css.ts` or its actual ordered-discovery owner | Sort a parent's discoveries by kind instead of token occurrence | `mockup-css`/`mockup-load`: font-before-image and image-before-font fixtures both retain their token order |
| NDR-C1-T7-N3 | `mockup/load.ts` | Forget a failed admitted pin from the load dedupe set | `mockup-load`: a root failure rediscovered in CSS causes exactly one read and one reservation |
| NDR-C1-T7-N4 | `mockup/load.ts` | Subtract unused reserved bytes after a smaller successful reply | `mockup-load`: the next over-budget nested row is still skipped with zero reads |
| NDR-C1-T7-N5 | `mockup/load.ts` | Recycle the reservation after a failed reply | `mockup-load`: the next over-budget nested row is still skipped with zero reads |

For N4 and N5 use separate real CSS-extension/load fixtures with `B = 5 * 1024 * 1024`. Before replies assert the admitted initial reservations total exactly `B - 1024`, with fewer than 64 rows and every individual reservation within its existing class cap. One admitted root image reserves 8192 bytes. In N4 it successfully returns 4096 bytes; in N5 that image fails. Hold a separate admitted stylesheet until that outcome, then release CSS discovering a unique image whose exact-pin listed reservation is 2048 bytes. With the correct nonrecycled budget `(B - 1024) + 2048 > B`, so that child is skipped and has zero reads. N4's wrong recycling frees 4096 bytes and N5's frees 8192, either of which makes the child fit; each respective mutant must therefore cause its own named assertion-red. Filler assets stay individually within existing caps, count stays below 64, and no other failure may be the reason for skipping. Assert the reservation before and after the outcome and the child's verdict/read count, through actual CSS discovery/loading, not a hand-fed list.

Each row changes only the named guard. Record the actual implementation's unique snippet, assertion-red, restore hash and final green; do not label this planned table measured evidence.

### Task 8: C2 — mockup viewer and reader image integration

**Create:** `pwa/src/docs/MockupView.tsx`, `MockupFrame.tsx`, `pwa/test/mockup-view.test.tsx`, `pwa/browser/docs-mockup.browser.test.ts`.
**Modify:** `pwa/src/docs/DocsLeaf.tsx` at `HtmlStandIn`; `DocsHead.tsx`, `docsText.ts`, `docs.css`, `DocImage.tsx`, `ReaderFrame.tsx`, `reader/images.ts`; affected control/tap/contrast/markup/ring/worker scans.

**Interfaces:** `MockupViewProps = {readonly show: DocsShowOk; readonly context: MockupContext; readonly reader: MockupAssetReader}`. It consumes Tasks5–7 and produces the existing leaf Export publication plus a mockup source for Task9. `MockupFrameProps = {readonly srcdoc: string; readonly scripted: boolean; readonly title: string; onNavigated(): void}`. Its React key is mode+nonce, not author text.

- [ ] RED: HTML leaf mounts viewer; >1MiB requires tap and >2MiB is download-only; refusal Source/Download, no Render anyway; reset script/origin choices on doc/mode change; draft and omitted assets truth; normal stop destroys frame; second load notices/tears down and never remounts automatically.
- [ ] RED real-view retry/context boundary in `mockup-view.test.tsx`: attempt P is loading mutable latest/draft CSS when movement triggers the existing view-level relist. The first movement aborts/invalidates P, discards its buffered discoveries, pending results, assets and reservations, then starts Q from the new root listing/pin with a fresh plan/budget. Resolve a held P stylesheet after Q starts; its uniquely eligible child must never be discovered, fetched, admitted or published in Q. Q's context has different listing/pin/withheld outcomes and its own count/byte boundaries. Its plan uses only Q's context and root references; no P bytes or reservations carry over. A second movement in this same view yields failed/changing with manual retry and no third attempt; historical-unavailable gives zero relists. Keep `loadMockupAssets` itself free of relist authority. These tests drive the actual viewer lifecycle, not a duplicate test-only retry controller.
- [ ] RED reader assets: failed401 is visible and retryable after sign-in; old body abort cannot publish data/draft counts into new body; overlong seed/ref returns a controlled fallback rather than a whole-page exception. Keep stricter reader limits and existing per-screen queue.
- [ ] Run unit cases then implement viewer using existing header, 70dvh frame and white-canvas token, Run/Stop/Load external/Fullscreen/New tab/Source/Download. Fullscreen and new tab navigate to the console's existing full-frame shell; never raw active bytes or author URL. Source uses one CodeBlock/store, plain first; Download original bytes.
- [ ] GREEN real browser: empty sandbox vs exactly allow-scripts, no src/name/allow/allowfullscreen, no frame-origin cookie/storage, no parent messages, no popup/top-nav, meta-only policy independent of csp attribute, second-load teardown. Compare app chrome/cross-width controls and full existing browser suite for navigation regressions.
- [ ] Measure independent mutations for sandbox, second-load teardown, meta-only control, source-store path, draft state reset, auth retry and stale body. Also independently mutate the view generation guard (late P may not publish/discover), disposal of P's buffered discoveries, fresh Q reservation plan (do not reuse P), and the once-only relist cap (second movement may not start a third attempt). Each has its own named `mockup-view` assertion-red and restored hash. Commit.

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

**Modify:** `ReaderFrame.tsx`, `reader/policy.ts`, `docsLinks.ts`, `reader/bridge.ts` and their existing tests, explicitly `pwa/test/reader-policy.test.ts`, `reader-bridge.test.ts`, `reader-frame.test.tsx`; `pwa/browser/reader-frame.browser.test.ts`, `reader-lab.browser.test.ts`; `pwa/test/reader-lab-run.test.ts`, `reader-lab-verdicts.test.ts`, source scans; `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` for the three focus sentences below; narrow `pwa/src/readerLab/run.ts`, `verdicts.ts` and RL-a files only after current ownership/claim check. Claim these actual-base paths before edits. The coordinator owns historical plan/ledger corrections separately.

- [ ] RED real symptom: post-mount fallback consumes the correct fragment in the plain view; same-page filename+fragment scrolls without a needless new body fetch; overlong/refused image seed safely falls back. Actual-library hidden-character copy opens the confirmation sheet before clipboard write. Replace ineffective hash browser fixture with a target whose position proves scrolling.
- [ ] RED focus-steal carry (desktop mails 17022/17033/17041, contract correction 17052): at the actual D base hold the lazy reader chunk, focus a mounted host head control before release, then release and wait for frame/readiness. That control retains focus, and next Tab follows its host DOM order rather than jumping from the iframe to an unrelated door. Cover phone-born and desk-born heads, all eight reported first-Tab targets still applicable, normal/held chunk timing and an observable release handshake; no mount-then-refocus helper. Also hold the bridge's asset/Mermaid wait, move focus while it is pending, and prove the decision uses focus after that final wait, not a stale pre-await snapshot.
- [ ] Preserve the positive M8.1 contract explicitly: retain the existing live case's exact iframe attributes/CSP equality, `focusedAtInsert === true`, focus at ready and later when no external host element owns focus. Add a separate host-owned-focus case with `focusedAtInsert === false`, retained control focus at ready and next-Tab order. Do not simply weaken/delete M8.1 or always disable frame focus. The library at 1.1.0 accepts boolean `HostAdapters.focus`, focuses synchronously after insertion when true, and does not refocus at ready; its explicit `command()` focuses synchronously regardless of this mount flag. No library change is required by this plan.
- [ ] Implement the pure `readerMountFocusFor(profile: ReaderMountProfile | undefined, hostOwnsFocus: boolean): boolean` in `reader/policy.ts`: the existing lab profile retains true; the Docs profile returns `!hostOwnsFocus`. Unit-test both Docs arms and the unchanged lab arm. In `reader/bridge.ts`, after all asset/Mermaid awaits and immediately before synchronous `mountDocFrame`, sample `el.ownerDocument.activeElement`; `hostOwnsFocus` means a connected element other than body/documentElement outside `el`. Sample once, pass that fact to the pure rule and forward its boolean through the existing `focus` adapter key, with no intervening await. Default body/root/no-owner still focuses the reader; a live external control is not displaced. Test the forwarded boolean and unchanged adapter key set, lab timing and explicit tool taps' synchronous frame focus. Re-anchor this against the actual D/library base before editing.
- [ ] Before D dispatch, the coordinator allocates and defines a known focus-contract departure from D's issued block, naming the existing rich-docs §4.1 `Focus` row ("The parent focuses the frame on mount, so the layout's keys work at once"), §6 `Keys` row ("The parent focuses the frame on mount (§4.1)"), and M8.1 ("The frame takes focus on mount."). Task 13 amends all three in the claimed rich-docs spec to say mount focuses when no external host element owns focus, retains the owner's focus otherwise, and explicit reader commands still focus synchronously. Include the issued definition in the D brief and results; no guessed number, historical evidence rewrite or unrecorded spec departure. Adoption leaves today's focus contract unchanged and does not claim this fix.
- [ ] Measure two independent focus mutations: restore unconditional Docs mount focus (held host-control assertion must fail), then always disable Docs mount focus (the original no-owner M8.1 live focus assertions must fail). Restore/hash-check each and final green. Record peer reproduction separately from this run's measured red/green. This required D deliverable closes only with both sides of the contract and all three spec amendments before E/F acceptance; it is not accepted/deferred.
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

- [ ] Complete the standalone/native capability inventory, explicitly reconcile the rich-docs print, figure-overlay Back-to-close and old-origin state rows with #1418, and amend the rich-docs spec through its claimed, reviewed follow-on task. Older Later/Dropped text is not a waiver. An unresolved product conflict blocks E/F; this step authorises no state migration or sandbox relaxation.
- [ ] Refuse final E/F acceptance until required appearance continuity and #1418/#1420 parity/draft work have scoped specifications/leaf plans, merged reviewed implementations and actual evidence. The existing A–D tasks do not implement those extensions. Record every feature and side-by-side comparison; a Backlog ticket or a requirement paragraph is not closure.
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
- [ ] Execute every extension acceptance row below against the same final installed release set and the reviewed leaf specifications; record each capability separately with the evidence interface above. Compare the standalone/native capabilities side by side by action and observed result, not just screenshots or a list of tickets. A missing row, failure, unresolved parity disposition or unmeasured mandatory check blocks F and retirement.
- [ ] Prepare one concise device item for real-only rows: one-bar and reachable tools at412×915, on-request figures, released-build lab E17/E18, synthetic mockup/script risk, iOS browser+installed Save, Android Share/Copy/Export usable file, desktop Firefox static export. Reuse existing phone blocks only as historical evidence, never as this build's result. No request to repeat old evidence merely for paperwork.
- [ ] Apply already specified scripts-confirm/export-flat/share-file contingency if its trigger is measured; return a code defect to a scoped worker/review cycle, then repeat affected acceptance on the new release. Do not discard a failing phone block or widen CSP to get a pass.
- [ ] Commit final handover: actual shipped features, exact evidence, limitations, CarryReceipt with zero blocking/unclassified rows, operator-only retirement pending if applicable, rollback route. Report “native delivery verified” only when every mandatory row passes or has an existing explicit accepted outcome. Keep programme open for a mandatory retirement gate; no false whole-programme closure.


**Required extension acceptance matrix (execute in F, not satisfied by earlier worker evidence):**

| Capability | Installed action and required observation |
|---|---|
| Appearance | Exercise both canonical skins, all twelve canonical palettes and Follow the system; verify host-selected appearance on ordinary/lazy open, changes while open under the reviewed extension contract, native chrome/typography/surfaces/focus/accessibility and retained phone/desktop geometry budgets. No independent theme catalogue or mode-only substitution. |
| Outside folders | Settings add/remove for a non-repo root; read the same admitted sections/rendering with the not-in-a-repo label and last-modified truth; no fabricated history/ref. Verify readonly containment/redaction and escaping-symlink refusal under the reviewed extension design. No Git conversion. |
| Layout variants | Open every kept variant, including classic/A/B/C and the existing AB default; choice persists as the reviewed contract specifies and remains usable on phone, laptop and wide views. |
| Large files | Open measured real-file fixtures above 2 MiB using the reviewed bounded stream/page design; prove below/at/above the approved ceiling and truthful over-ceiling output, including the reviewed overlay-cap decision. No blanket cap lift. |
| PDFs | List, open in the isolated inline viewer and download the same admitted PDF; verify self-hosted assets, no CDN, phone and desktop operation and unchanged isolation boundaries. |
| Tracker links | Configure generic regex/URL templates in Settings; matching IDs resolve correctly, nonmatches remain text, and no private tracker is hardcoded. |
| Draft review | Share a frozen read-only snapshot, verify the draft banner and unchanged shared bytes after edits, newer-draft notice/re-share, last-view TTL, early removal on same-file branch commit, UI Pin/Revoke, retention, immediate revoked 404 and unreadability after expiry. Exercise the reviewed access model against the recorded no-session criterion; never a live working-tree read. |
| Complete parity inventory | Run every feature row from the amended side-by-side inventory, not only the examples above. Explicitly evidence print and figure-overlay Back-to-close outcomes and the explicitly resolved old-origin-state disposition without an implicit waiver, state migration or sandbox widening. |

### Task 18: Separate operator retirement and final programme closure

**Owner:** operator for each infrastructure act; coordinator prepares and verifies receipt. This is not permission to touch live docserver units/config, proxy mappings or project roots.

- [ ] Recheck retirement prerequisites: F verified including required appearance work, all #1418 parity and #1420 draft-lifecycle acceptance rows with merged child evidence, and a side-by-side check finding nothing missing. Cover all six sections and the complete amended capability/state inventory, including outside non-repo folders, variants, large files, PDFs, configured tracker links, print, figure-overlay Back-to-close and the explicitly resolved old-origin-state disposition. Current Share is not draft-store acceptance. Missing evidence or an unfinished child blocks retirement.
- [ ] Verify every configured root is served natively under its approved containment/redaction policy, including non-repo folders without mandatory Git conversion. No active session may be working in a root that an independently justified move would affect. Required docs/doctor/docs-sw and phone evidence remain. If any prerequisite fails, keep both previews and report pending.
- [ ] Operator sequence: denylist condition; only justified safe root moves, preserving existing Git history and without forcing non-repo folders into Git; remove old `/docs` proxy mapping on every PWA origin **before** any stop; prove native content/ref/draft/auth; update operator preview convention (durable GitHub links unchanged); stop forwarder; stop old docserver, retain history/directory; prove listener closed.
- [ ] Verify outcome without printing private config/secrets. Rollback never serves raw standalone HTML on authenticated app origin. If cutover fails, record exact boundary and keep a safe separately authenticated preview; no hidden infrastructure workaround.
- [ ] With final receipts committed and all required run/item states measured, mail MERGED/closure before closing the last run. Clear coordinator intent only when the role ends. Final response distinguishes native delivery from standalone retirement, with no “complete” claim ahead of evidence.

## Per-wave brief and acceptance contract

Each dispatch includes only wave specifics: programme/spec/plan paths; exact task range and actual base; allowed files and overlapping-claim agreement; produced/consumed interfaces; existing approvals and evidence applicable to that wave; issued deviation block and defined departures; chrome/test routing; required mutation/browser/device rows; branch-discipline sentence; stop conditions. Do not paste the standing worker skill.

**Routing:** main worker Opus/high; native Sonnet/high implementers (including parser/asset/diff/adapter tasks5–7/9/11–12); Sonnet/medium only for mechanical documentation; per-task Opus/high reviewers for untrusted-input/boundary tasks and Sonnet/medium for mechanical documentation tasks. Every Agent call names model and required effort literally; never Fable. Workflow mode off. External reviewer uses the held-out contract in Tasks16/design §8, never the older single-refuter shortcut in historical plan text.

**Acceptance:** remeasure wave-done, server-verify fingerprint, separate review run, accepted report, exact-head required PR/queue checks, actual MERGED. Feature worker does not merge their own PR; coordinator ledger work stays on ledger branches. Open successor before closing predecessor; report copies survive child reclamation. No child wait hidden behind a long coordinator workflow or poll loop.

## Deviations found

No new deviation number is defined by this documentation-only plan. At each implementation run opening the coordinator allocates and defines its known departures in the ledger in the same act. The historical class-cap asset reservations (including the base spec's listed-size amendment), conditional Docs mount focus in Task 13 (including its three rich-docs focus sentences), conservative diff limits and serial C/D decomposition are labelled coordinator calls, not historical operator rulings. A departure from an existing normative sentence gets an issued entry before dispatch, not a guessed number.

## Results

**R10 review corrections, 2026-11-10:** complete parity/state reconciliation, recorded frozen-snapshot/re-share decision, summary dependencies, coordinator claim ownership and explicit F extension acceptance rows. No product implementation, state migration or safety relaxation; exact-head review/CI remain gates.

**Entry correction, 2026-11-10:** durable appearance and recorded #1418/#1420 no-feature-loss/draft-lifecycle gates restored. Detailed extension designs and implementation leaf plans remain pending. This amendment does not implement those features, relax safety caps, authorise infrastructure actions or expand adoption run 1532.

Entry work started 2026-11-09 under the eight-hour autonomy mandate; no product implementation or acceptance is claimed. Run 1532 remains planned pending the amended-plan/review/landing entry gate and shared-file ordering. The ledger records the verified #2480 merge and live C16 overlap. The receipt below freezes the finite carry inventory without asserting a fresh audit. Red/green, mutation, independent handoff review, exact-tip CI/queue/full-suite, release/inventory/device and cutover receipts are still execution work; plan publication fills none of those boxes.

### CarryReceipt — frozen inventory at delivery entry

Each source is the corresponding completion-design §7 row. `measuredRef` is not a fabricated current-code inspection: these rows remain open until their owning task supplies exact evidence. Historical accepted/deferred candidates are classified at E from their existing ruling, owner and next-touch trigger; an unknown is never closure. Private-first rows publish no vulnerability detail.

| source | measuredRef | status | ownerTask | testOrEvidence | disposition |
|---|---|---|---|---|---|
| W8a fragment, same-page link, seed fallback | not remeasured at entry | open | D Task 13 | Reproduce, red/green fix or cite exact shipped guard and test | Owning task must record exact current evidence and disposition |
| W8a copy/hash/meta-only/stray controls | not remeasured at entry | open | D Task 13 | Browser evidence and independent mutation controls | Owning task must record exact current evidence and disposition |
| W8a pure import, scan/comment/error-name/worker timeout residue | not remeasured at entry | open | D Task 13 | Exact-source inspection and test-backed repair; no blanket scan allowance | Owning task must record exact current evidence and disposition |
| Reader image 401 and planner residue | not remeasured at entry | open | C Tasks 6–8 | Shared plan and visible retry after sign-in | Owning task must record exact current evidence and disposition |
| RL-b scroll-before-append, busy-frame 0.8 guard | not remeasured at entry | open | D Task 13 | Effective tests, two measured mutation rows, limitations preserved | Owning task must record exact current evidence and disposition |
| RL-a comments/scanner/plan errata/minor tests | not remeasured at entry | open | D Task 13 | Source-backed corrections and declared non-behavioural items | Owning task must record exact current evidence and disposition |
| Header mutation counts, D-7958 wording, fallback-only retry, finding wording | not remeasured at entry | open | D Task 13 and E Task 15 | Source-backed status, no fabricated prior red counts | Owning task must record exact current evidence and disposition |
| Compression actual-config emptyOutDir and runner Node pin | not remeasured at entry | open | E Task 15 | Current build-config guard and node-floor evidence | Owning task must record exact current evidence and disposition |
| Compression both-order negotiator next-touch case | not remeasured at entry | open | E Task 15 | Run both orderings if touched; otherwise retained accepted next-touch with named owner | Owning task must record exact current evidence and disposition |
| Export direct assertions/rawquote/results and W5h-b text | not remeasured at entry | open | E Task 15 | Verify later closure before marking closed; do not resurrect automatically | Owning task must record exact current evidence and disposition |
| W3 generation map, key redaction, JSON parse, lowerAscii/prose | not remeasured at entry | open | E Task 15 | Current-source test and disposition; bounded read/cache invariants retained | Owning task must record exact current evidence and disposition |
| W2 two widening arms, four evasion spellings, docstrings/results | not remeasured at entry | open | E Task 15 | Pin each allowance independently, not a global scanner exemption | Owning task must record exact current evidence and disposition |
| W4 review 412 and nesting/parse/alias/hook/count/r10/r11/census residue | not remeasured at entry | open | E Task 15 | Compare later fixes and accepted arms, test any surviving defect | Owning task must record exact current evidence and disposition |
| Share cancelled-sheet notice | not remeasured at entry | open | E Task 15 | Verify cancellation result/copy and test; no error on user cancellation | Owning task must record exact current evidence and disposition |
| SEC-3 helper termination, SEC-4 stamps, post-fetch stamp, branch:null, partial clone and stripped-byte count | not remeasured at entry | open | E Task 15, privately triaged first | Verify current code and historical rulings before public detail; confirmed reachable security defects block release | Owning task must record exact current evidence and disposition |
| U5 security report and baseline headers | not remeasured at entry | open | Coordinator, E/F | Privately verify owner/status; no premature public vulnerability detail and no unverified clean claim | Owning task must record exact current evidence and disposition |
| Library C114 | not remeasured at entry | open | Existing library programme | Missing mutation coverage and evidence corrections belong to first 1.1.x maintenance work; 1.1.0 CSS measured correct, no proved consumer defect or invented release dependency | Owning task must record exact current evidence and disposition |
| Highlighting requests/colour divergences | not remeasured at entry | open | Existing library owner; E receipt | Retain accepted divergence or cite actual fix; do not promise a new library implementation | Owning task must record exact current evidence and disposition |
| Per-job highlight latency | not remeasured at entry | open | Operator-deferred | Retain owner/next-touch trigger, not a new release blocker | Owning task must record exact current evidence and disposition |
| Required appearance continuity | operator request 2026-11-10; no implementation claimed | open | Required follow-on leaf plan; E/F verify | Canonical catalogue, both skins/all palettes/system, lazy/live changes, accessibility and existing geometry budgets | Must ship before final E/F acceptance |
| #1418 parity and #1420 draft lifecycle | recorded operator ruling 2026-10-25; child tickets still Backlog at 2026-11-10 check | open | Required follow-on spec/leaf plans; E/F and Task 18 verify | Outside non-repo folders, variants, large files, PDFs, configured tracker links, private draft snapshots/lifecycle, side-by-side installed check | Required; old Later/Dropped classification is not a waiver |
| Print, figure-overlay Back-to-close and old-origin state | rich-docs parity/state rows conflict or need reconciliation with later #1418 promise; no full implementation audit claimed | open | Required parity follow-on spec/leaf plan; E reconciliation, F installed comparison | Complete capability/state inventory; preserve current sandbox/state rules until reviewed resolution | Older Later/Dropped text is not a waiver; genuine product conflict needs operator ruling before E/F |
| Other hosted publishing, bundle Export, fullscreen Share and XML colouring restoration | not remeasured at entry | open | Existing explicit Later/Dropped decisions, excluding #1418/#1420 | Not delivered; do not confuse general hosting deferral with required private draft-review sharing | Owning task must record exact current evidence and disposition |
| Desktop mails 17022/17033: reader-mount-steals-focus | C16 worker reported reproduction at `43dfc2a51311f7e587636677998258491668429e`: a 3-second held reader chunk failed all eight first-Tab-stop cases; not independently reproduced by this coordinator | open | D Task 13 explicit focus regression/repair; E Task 15 verifies closure | Held-chunk host-control/next-Tab and preserved no-owner M8.1 cases, two focus mutations, issued D departure and three rich-docs focus amendments in Task 13 | Routed from the previously unimplemented A/next-touch note by entry review 17041; adoption does not claim this fix. Must be resolved with measured evidence before E/F acceptance; no silent acceptance |
| Desktop mail 17022: unfolded-refusal-name-cut | reported at C16 `43dfc2a51311f7e587636677998258491668429e`; not independently reproduced | open | E / header carry closure | Refused GitHub + unfolded crumbs across the reported narrow-width band; measure name truncation | Preserve peer's report, reproduce and disposition; not a new permission to rewrite desktop A |

## Where things stand

### Agreed

- One remaining delivery line in this programme; reuse approved choices and both phone blocks.
- A includes real Settings access; B keeps its approved two-run split; W7 is last.
- Implementation, review, landing, release, installed evidence and retirement are distinct facts.

### Waiting on you

- Do not repeat approval/signing/phone evidence or the recorded frozen-snapshot choice. Required follow-on designs still owe access-model/comment/security decisions and any genuine parity/state conflict; raise only operator-owned choices as precise console items when needed. Reserved rollout, device and retirement actions also wait for exact entry evidence; all unblocked work proceeds autonomously.

### Later

- Only the design §7 explicit accepted/deferred/non-goal rows. No unowned “follow-up” may be used to erase a required delivery task.
