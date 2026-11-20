# Task X5: HTML pages as artifacts, on an isolated origin

The task note for native Docs reader wave 29 (X5, run 2837): what the ledger should learn from this design wave, and the adversarial pass's findings with what was done about each. The design is `docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md` and its leaf plan is `docs/superpowers/plans/2026-11-19-native-docs-html-artifacts.md`.

## In short

- **The ruling carried out.** The operator ruled on 2026-11-19, on X2's conflict C3 (ask 598), that HTML pages are supported at artifact level, with the safety in the hosting. This wave designed that hosting. It changed no code and touched no live service.
- **The design.** Pages run on two names of their own, outside the console's site: a script-free wrapper on the artifact host, and the page in the wrapper's frame on the content host. A second server listener serves them, with four routes and no console route. Access is by a 256-bit capability in the URL path, minted under a signed-in session, held in memory and bound to that session. It expires after an idle hour, at 12 hours, or at 2 hours when the page reads drafts. Egress is closed by default; outside hosts and windows are opt-in at launch. X2's walls tier stays the default view.
- **For the ledger.** Two departures defined, D-8786 (X2's C3 text, wave A1) and D-8787 (the completion plan's walls sentences, wave A3). Number 8788 of the block is unused. Five implementation waves, A1 to A5. A1 waits for X3 R1, which waits for X2 P1, and A5 waits for X2 P6. No exempt class is added, so X3's class 9 does not collide. C3 moves from Conflict to Gap; the Task 17 rows are AR-A1 to AR-A5, with lab rows ART-L1 to ART-L12.
- **Open product choices.** None. Every choice was technical and is argued in the spec. Six parity differences from the standalone reader are recorded, not waived (spec §8): a fetch from an outside API fails; an artifact runs in a new tab, not inline; an HTML page in an outside folder runs within the walls only, because X2 §4.1 reads outside folders only under a signed-in session (running it in full is Later); and three manifest exclusions, a reference above the page's folder, Markdown beside a section-root page and a file with no measured size. The new tab and the outside folder hold for every artifact row; F12 carries the other four as well, and moves to Same only with them recorded beside it. Earlier versions of a page are not in the tier, which is no parity loss, because the standalone reader serves no versions.

## The adversarial pass

One Opus (high) read of the spec and plan, before wave-done. It raised 22 findings: 1 blocking, 15 important, 6 minor. All 22 were accepted and fixed in this pull request.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Blocking | Outside-folder pages would be read through a bearer capability, against X2 §4.1 ("never without a signed-in session"), with no departure | Outside folders are left out of the artifact tier (spec §3.2, plan Global Constraints, A5.1). This makes the departure unnecessary, so number 8788 stays unused. Bringing them in is Later |
| 2 | Important | The fetch fence refused SVG used as an image and a same-origin `fetch` of HTML | The fence decides by `Sec-Fetch-Mode`. Navigations must be `iframe`, or `document` with windows ticked. Every other request must be same-origin. `serviceworker`, `embed` and `object` are always refused (spec §4.3, A3.2, A3.3) |
| 3 | Important | The site rule read `PUBLIC_SUFFIX_TRAPS` as an accept list, reversing its direction | Added the tier's own `ARTIFACT_PUBLIC_SUFFIXES` = `['duckdns.org']`, measured on the list. A `nip.io` case is refused (spec §2.3, MX5.43) |
| 4 | Important | "Console reads always keep one slot" was false: the lane is a head-only FIFO, admits one job of any size when idle, and shares its queue | Lane rules for source `artifact`: console jobs go first, one artifact job runs at a time, artifact jobs are capped at 1 MiB raw with their own queue of 16, and artifact prepares are limited to 1 at a time and 3 a minute. The test is rewritten (spec §5, A3.3, MX5.34) |
| 5 | Important | The mint answer passes the server's credential mask, and the new GETs were missing from the mask inventory | A token the mask would alter is drawn again. Both GETs were added to the inventory (spec §3.2, A2.3, MX5.45) |
| 6 | Important | The ring totality and docs-ring import pins would go red | The architecture map gains a row (A1.3) and `ccdsource.ts`'s import list gains its entries (A2.3) |
| 7 | Important | A2 used X2 P1's stat pin and P2's folder pin before either exists | A2 now depends on X2 P1. Folder pins are dropped (plan wave table, Figure 1) |
| 8 | Important | The capability is a bearer token usable by any client, which extends access to 12 hours | Stated as A11's main residual, A6 corrected, and a 2-hour cap added for pages that read drafts (spec §3.3, §7) |
| 9 | Important | Caddy's error log can record a path with its token | Stated (spec §2.4, A9). Lab row ART-L10 checks for it, and A4 suppresses the entry if found |
| 10 | Important | The artifact block lacked the stored bind, and re-running the console's arm dropped the block | Both blocks are generated from the exposure file on every run, with the bind and with no `log` directive. Re-run test added (spec §2.4, A4.1, MX5.48) |
| 11 | Important | A ticked outside host could be one of ccrc's own names, voiding path scoping | Refused as `bad-origin` and never offered (spec §3.2, A20, MX5.44) |
| 12 | Important | Fences were tested only on the pure decider | Route-level `app.inject` cases added (A3.3, MX5.41) |
| 13 | Important | "Clear this host's data" cleared the wrong partition, and `"cookies"` reaches a whole registrable domain | `/clear` now loads in the wrapper's frame and clears `"cache", "storage"` only. A byo pair requires a dedicated domain. Lab row ART-L11 added (spec §3.4, §2.4) |
| 14 | Important | Artifacts share live channels, and a passphrase stored by one page can leave through another | A2 and A13 residuals widened. The sheet's "Others open" line added (spec §6.2, A5.2) |
| 15 | Important | The uncommitted count reached the operator only after the mint | A scope read door answers the counts before anything is minted. The mint answer carries them too (spec §3.2, A2.3, A5.2) |
| 16 | Important | No `Range` support or `Content-Length` | Single-range 206 and 416, `Accept-Ranges`, and `Content-Length` from the manifest. Lab row ART-L12 added (spec §5, A3.2, A3.3, MX5.46) |
| 17 | Minor | A12 wrongly claimed `worker-src` excludes service workers | Restated. A mutation row added for the destination half (MX5.42) |
| 18 | Minor | A page's own referrer meta can send the token to a ticked host | Stated in A7. The sheet line says a ticked host "may see this link" |
| 19 | Minor | MX5.1, MX5.7 and MX5.14 named tests that would not go red | Renamed to tests that do: listener "no shell", store "minted token length", and a store record walk |
| 20 | Minor | Grammar mismatch for loopback; `docsApi` was missing the mint call | One loopback rule (console `localhost`, artifacts `127.0.0.1` by port). The mint call and the scope call were added (spec §2.3, A1.2, A2.3) |
| 21 | Minor | D-8786 kept sentences contradicting "one choice"; the X3 token-storage claim was wrong | The whole In short bullet is quoted and replaced. Spec §3.5 corrected: X3 keeps its token in its index |
| 22 | Minor | Wrapper COOP could sever popups, dialogs are unmeasured in cross-origin frames, and the DDNS unit line was unworkable | COOP is `same-origin-allow-popups`. Lab rows ART-L8 and ART-L9 added. `CCRC_DDNS_DOMAIN` becomes a comma list, so the unit is unchanged (spec §2.4, §4.2) |

## Review round 1 (run 2850)

Review run 2850 read the branch at `d1bb9ffee` and confirmed 13 findings (F1 to F13) and 13 advisories (A1 to A13). Each was fixed in its own commit, except F2 and F3, which share one, and A2, which was a line of the pull request body.

| Finding | Fix |
|---|---|
| F1 | D-8786 also records C1 as ruled (ask 596, a fresh start), so X2's spec no longer lists C1 as waiting |
| F2, F3 | A1 waits for X3 R1, as R1 waits for X2 P1. A1 moves R1's `isReviewToken` body to `shared/capabilityToken.ts` and re-exports the name, so R1's plan and tests are unchanged. Every shared file is listed with its order |
| F4 | "Open as artifact" is offered on every HTML page at its branch's current version beside its walls view, so no refusal detector is built (narrowed to the current version in round 2, N3) |
| F5 | The liveness port measures the current secret generation on each call. An absent or unusable secret ends every capability. Real-store test |
| F6 | A4 writes a stock-Caddy global block that filters `request>uri` and the `Referer` header out of every log entry. A test pins it. ART-L10 confirms it; a token found fails ART-L10 and AR-A4, and the tier stays off with the operator told and no waiver offered (one rule since round 2, M5) |
| F7 | The scope read and the mint refuse `pin-moved` when the tree read is not the pinned version |
| F8 | `buildServer`'s body builds the shared session store, docs composition and capability store once and hands the artifact instance out as `app.artifactServer`. `Deps` gains nothing (the adversarial pass moved this off a wrapper, which would have reddened four tests that read `buildServer`'s body) |
| F9 | Loads wait in a bounded queue (64, 90 s) instead of a 429. One snapshot per large entry. The busy and timeout answers are stated. Many-loads test |
| F10 | Full hostnames in `CCRC_DDNS_DOMAIN`. A re-run of any arm carries the artifact keys |
| F11 | The settings census, the install fixture, the secret-mask scans and the gate's route count are named in the Files lists |
| F12 | The artifacts arm prints copy, reload and restart, with no passkey line, and a test pins it |
| F13 | `CONTENT_HEADERS` is pinned to literals. The bad-frame bytes never reach the client. Rows for every named limit and fence. Spies on every `console` method |
| A1 to A13 | COOP wording; the PR body's Parity line; the message rule; `/clear`'s CSP and the gate's words; P1's real names; no outward import and a null size rule; sources quoted only for what they say; real Task 17 rows; doctor's Host; golden answers for the browser harness; a section path and no port default; grants argued and section roots narrowed; token crossing named |

Round 1 left the mutation rows at MX5.1 to MX5.69. The adversarial pass ran again over the round's diff before this wave-done: one Opus (high) read found 4 important and 9 minor defects and no security regression, and confirmed every quoted passage byte for byte. All 13 are fixed in this round. The important four: the seam keeps `buildServer`'s body, because four tests read it; the wait is 90 s, so six large files load whole; the fence admits a same-origin download; and the bytes port has a `busy` word.

## Review round 2 (run 2860)

Review run 2860 read the branch at `a2a439fcf`, closed 23 of the 26 round-1 ids, and confirmed 10 findings (N1 to N10) and 5 advisories (M1 to M5), with two residues. The coordinator ruled N1, N3 and N4. Each was fixed in its own commit, related advisories folded in.

| Finding | Fix |
|---|---|
| N1 (ruled a) | A capability's end reaches work in flight: `lookup` again at admission and before each frame, a revoke drains the queue with the identical 404 and cuts running responses, and `ARTIFACT_FRAME_STALL_MS` (30 s) and `ARTIFACT_RESPONSE_MAX_MS` (10 minutes) free a slot a reader holds. M1 and M3 folded in: expiry is decided inside the mint's count, `sweep()` is gone, and §9 lists the queue constants |
| N2 | A failed artifact listen warns once, turns the tier off with its own word `artifact-listener-down`, and leaves the console listening; doctor names the port |
| N3 (ruled) | Version pages are out of the tier, with a sentence pointing to the current version; the offer is narrowed to every HTML page at its branch's current version; `pin-moved`'s remedy is one action, Reload and open again |
| N4 (ruled a) | The offer sits on `DocsLeaf.tsx`'s too-large and stand-in branches, and A5 waits for X2 P1 and P3. The walls' 2 MiB cap is never consulted; the tier's one per-file limit is `DOCS_RANGE_MAX_BYTES`, and a page above it is refused `page-too-large`. M2 folded in: the shared-file table is complete |
| N5 | Six parity differences, one count in spec and note |
| N6 | The capability keeps its `DocPin` and the tree's ref, and a table maps each entry onto the shipped reads |
| N7, N8, N9 | Mutation rows MX5.5, MX5.30 and MX5.49 now go red: an accept-list host above the console, crafted manifest keys, a rendered `MockupView` |
| N10 | Sibling maps for the two unions, `CONTROLS` rows, the doctor table entry, and literal keys in the carry |
| M4, M5 | The sibling-import rule and the scope read's query; the DDNS start degrades; one rule for ART-L10; the golden test's Sec-Fetch sets are Chromium's |
| Residues | The log block writes `level INFO`; a draft page above 4 MiB is refused `draft-too-large` |

Mutation rows now run MX5.1 to MX5.92. The adversarial pass ran again over this round's diff before the wave-done: one Opus (high) read found 3 important and 5 minor defects and no security regression, all fixed in this round. The important three: the launch sheet on a page the console never loaded has no pre-scan, so it offers no outside host and says so; the scope read's malformed-query answer is the docs parser's own failure shape, and the mint checks its body with the same parsers; and the doctor table's test is `ccrc-doctor-core.test.ts`.

## Measured, and how

- Shipped source on `main` at `0b96bd0dc`, read by this wave and three read-only fact-check subagents (Sonnet, medium). The plan's Results lists every file.
- The quoted sentences of D-8786 and D-8787 were checked byte for byte against their two source documents (`grep -F`, all matched).
- The Public Suffix List's `duckdns.org` entry was read on 2026-11-19. No browser behaviour was measured; the lab rows do that in F.
