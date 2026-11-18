# Native Docs reader full parity (X2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task, under the dispatched `ccrc-worker` role. Each wave P1 to P6 is its own run, dispatched by the coordinator; one worker never executes more than its wave. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every required gap of the X2 parity inventory, so the standalone reader can retire with no feature lost.

**Architecture:** Six waves. P1 adds bounded range reads (`docs-show-range`) under every existing cap. P2 adds outside folders through a new read verb and a fleet-box registry. P3 adds an isolated PDF frame. P4 closes the listing and ref gaps and adds the docs settings store. P6 adds Print (stage 1) and the in-walls page loader. P5 adopts the library release (layouts, tracker links, Back places, flags, Print stage 2) and comes last.

**Tech Stack:** TypeScript, React 19, Fastify, `node:sqlite` (`coord.db`), the ccd Python docs helper (`_docs_py` in `ccd/ccd`), package-local vitest, the existing browser harness, `pdfjs-dist` (one exact version, P3), `@synapsium-labs/docserver` 1.1.0 until P5 adopts the next release.

**Spec:** `docs/superpowers/specs/2026-11-18-native-docs-parity-design.md` (read it with this plan). Also the rich-docs spec `2026-10-12-rich-docs-reader-and-shared-renderer-design.md` §3 to §6, the base spec `2026-10-01-native-docs-reader-design.md` §5.3, §6.7, §6.9, and the completion plan `2026-11-07-native-docs-reader-completion.md` (Global Constraints, Task 17).

**Status:** 2026-11-18, X2 design wave (run 2632). No implementation is claimed by this document. Run ids and deviation blocks for P1 to P6 are issued when each opens.

## Global Constraints

- Reader frame sandbox exactly `allow-scripts`; shell CSP meta exactly `frame-src 'none'`; no parent-DOM access by any frame; no extra message channel; no window `message` listener anywhere in `pwa/src`; never `allow-modals`.
- `@synapsium-labs/docserver` exactly 1.1.0 until P5 adopts the reviewed next release by exact pin, with provenance, `npm audit signatures` and the import list (rich-docs §4.7). No library repository edit from a ccrc wave.
- Class caps stay 2 MiB (`DOCS_MAX_DOC_BYTES`, `DOCS_MAX_IMAGE_BYTES`); ccd ceiling stays `DOCS_MAX_FILE_BYTES` = 4194304; HTML at most 2 MiB, tap-to-render above 1 MiB; mockup assets 64 and 5 MiB.
- New ceilings (C4, the coordinator's design default): `DOCS_RANGE_FRAME_BYTES` = 524288; `DOCS_RANGE_MAX_BYTES` = 67108864; `DOCS_PDF_INLINE_MAX_BYTES` = 4194304 (lowered, never raised, if lab PDF-L2 fails); `DOCS_IMAGE_VIEW_MAX_PIXELS` = 67108864 with at most 16384 a side. Each is one constant in `shared/docs.ts`; ccd holds a parity copy only where ccd enforces it (`docs-parity.test.ts`).
- Both 2026-11-06 phone blocks byte for byte; the tap, one-bar and desktop-fit budgets stand.
- No folder read without a session: every outside-folder read refuses `auth-off` while sign-in is dark.
- No standalone-reader action of any kind. No live service, unit or config touched.
- Fixture HOMEs only for ccd; poisoned `gh` where a fixture spawns tools; `ccrc test -- <command>` for every test and typecheck, foreground, timeout at least 600000 ms; mutation runs through the coordinator's mutation runner, scratch outside the worktree.
- Public repository: neutral names (`project-a`, `lane-a`, `the fleet box`); no host, path, label or tracker host in code, tests, docs or commit text. The no-tracker scan of M11.23 enforces the last.
- Each wave opens with its own run and issued deviation block; a departure found mid-wave is `D-TBD-<slug>` and reported.
- Ownership against the sibling waves: X1 (appearance) owns the reader host's prefs and the Aa ownership; X3 (draft review) owns Share and the draft store. P1 to P4 touch no reader host file (`ReaderFrame.tsx`, `reader/bridge.ts`, `reader/policy.ts`, `DocsHead.tsx`, `docs.css`), with one exception: P2.4 edits `DocsHead.tsx`'s truth line and the five actions' off reasons only, serialised with X1 by claim (P2.4 claims the file only while no X1 wave holds it, and otherwise waits for the holder to release it). P6 and P5 edit the host files freely, and are dispatched only after X1's host wave has merged. ccd and `server/src/docs/**` edits serialise with X3's by claim, one wave at a time.

## Review Focus

- A file that changes between the listing and the open (draft, folder file, above or below 4 MiB): the read refuses `draft-changed`, never shows mixed or stale bytes. Owned by Task P1.2 (`range: a file changed since the listing refuses`).
- Cancel or navigation in the middle of a 64 MiB read: every frame dropped, nothing saved, the console still answers. Owned by Task P1.4 (`range reassembly: cancel drops every frame`).
- A folder removed while a page of it is open: the next read refuses and the page says the folder is gone. Owned by Task P2.3 (`folder: removed while open`).
- A PDF whose links, JavaScript or launch actions try to leave the frame: nothing navigates, nothing opens. Owned by Task P3.2 (`pdf frame: link annotation does not navigate`).
- Back pressed after the doc was replaced by another (stale places): the stale places are skipped, one Back shows the earlier doc, Forward still reaches the later one, and the old frame gets nothing. Owned by Task P5.3 (`places: stale places after navigating away cost no extra Back`, `places: Forward after Back from B reaches B`).

---

## Waves, order and file ownership

| Wave | Tasks | Depends on | Owns (create or modify) |
|---|---|---|---|
| P1 range reads and large files | P1.1 to P1.5 | `main` | `shared/docs.ts` (range block and ceilings), `ccd/ccd` (`_docs_py` range verb, snapshot cache), `agent/src/whitelist.ts`, `server/src/ccdargv.ts`, `server/src/docs/{policy,ports,ccdsource,routes}.ts`, `server/src/server.ts`, `server/test/{box-token-census,auth-gate}.test.ts`, `server/test/rings/fastify-l4.data.ts`, `pwa/src/docs/range/**` (new), `pwa/src/docs/objectUrls.ts`, `pwa/src/docs/DocsLeaf.tsx` (above-cap branches), `pwa/src/docs/DocImage.tsx`, `pwa/src/docs/docsText.ts` |
| P2 outside folders | P2.1 to P2.4 | P1 | `ccd/ccd` (`docs-folder`, `docs-folder-read`, walker, registry), `shared/docs.ts` (folder block), `agent/src/whitelist.ts`, `server/src/ccdargv.ts`, `server/src/docs/{routes,policy,ports,ccdsource}.ts` (handlers in `routes.ts`), `server/src/server.ts`, `server/test/{box-token-census,auth-gate}.test.ts`, `server/test/rings/fastify-l4.data.ts`, `pwa/src/screens/settings/DocsFoldersSection.tsx` (new), `pwa/src/screens/settings/SettingsIndex.tsx`, `pwa/src/docs/{DocsIndexView,DocsTreeView,docsTree,docsLinks,DocsBanners}.tsx/ts`, `pwa/src/docs/DocsHead.tsx` (truth line and off reasons only, serialised with X1 by claim), `CLAUDE.md` (the SAFETY sentence only), the forbidden-verb layers (`server/src/coord/approvalguard.ts#FORBIDDEN_CCD_VERBS`, `shared/api.ts#CHILD_DENY_CCD_VERBS`, `ccd/session-hook.sh`, `ccd/install-session-hooks.sh`, `ccd/ccd-entry.py`, `ccd/ccd`'s body guard) and their tests (`server/test/{ccd-spawn-child-settings,session-hook-approval-deny,ccd-forbidden-verbs-entry,ccd-ws-lease-mark-reach}.test.ts`), `server/test/single-definition/docs-ring.test.ts`, `server/test/{verb-gate,ccd-can-sites}.test.ts` |
| P3 PDF frame | P3.1 to P3.3 | P1, P2 | `shared/docs.ts` (`pdf` class, magic), `pwa/src/docs/pdf/**` (new: `PdfFrame.tsx`, `pdfPolicy.ts`, `pdfSrcdoc.ts`), `pwa/package.json` and lock (`pdfjs-dist`), `pwa/src/docs/DocsLeaf.tsx` (pdf branch), third-party notices |
| P4 listings, refs, settings store | P4.1 to P4.4 | P2 | `ccd/ccd` (index newest, ref resolution), `shared/docs.ts` (index field, ref grammar, `ico`), `shared/docsTracker.ts` (new, L0 checker), `server/src/coord/{schema,store}.ts` (`docs_settings`), `server/src/docs/routes.ts` (the settings handlers), `server/src/server.ts`, `server/test/{box-token-census,auth-gate}.test.ts`, `server/test/rings/fastify-l4.data.ts`, `pwa/src/screens/settings/DocsSettingsSection.tsx` (new), `pwa/src/screens/settings/SettingsIndex.tsx`, `pwa/src/docs/{DocsIndexView,DocsTreeView,docsTree,docsLinks}.tsx/ts`, `server/test/single-definition/docs-l0.test.ts` |
| P6 print stage 1 and the page loader | P6.1 to P6.2 | X1's host wave, P4 | `pwa/src/docs/print/**` (new), `pwa/src/lib/printAllow.ts` (new), `pwa/src/lib/readerRenderJob.ts` (the print tree), `pwa/package.json` and lock (the HTML parser), `pwa/test/{markdown-purity,markdown-worker-built,markdown-runner}.test.ts`, `pwa/src/docs/DocsHead.tsx` (Print row), `pwa/src/docs/docs.css` (print rules), `pwa/src/docs/mockup/{load,plan,policy}.ts`, `pwa/src/docs/mockup/shim.ts` (new) |
| P5 reading layer | P5.1 to P5.5 | the library release, P6 | `pwa/package.json` and lock (library pin), `pwa/src/docs/ReaderFrame.tsx`, `pwa/src/docs/reader/{bridge,policy,places}.ts` (`places.ts` new), `pwa/src/lib/historyPlaces.ts` (new), `pwa/src/lib/router.ts` (the one `popstate` consult and the unwind), `pwa/src/docs/readerHistory.ts`, `pwa/src/docs/DocsHead.tsx` (Layout row), `pwa/src/docs/print/**` (stage 2), `pwa/src/lib/trackerLinkJob.ts` (new), `pwa/src/lib/{readerRenderJob,markdownWorker,markdownRunner,readerLimits}.ts` (the `tracker-links` job, `docsRunner`, its budget), `pwa/test/{markdown-purity,markdown-worker-built,markdown-runner}.test.ts`, `server/test/single-definition/docs-ring.test.ts`, rich-docs spec §3.3 and §4.4 |

Every wave ends with the common acceptance cycle of the completion plan (exact-tip CI and CodeQL, privacy scan, review run).

## Acceptance rows (one to one with Task 17's matrix)

| Row | Task 17 row | Installed action and observation | Waves |
|---|---|---|---|
| AR-1 | Outside folders | Add a non-repo folder in Settings, open its six sections, see "Not in a repository" and each file's modified time; history, changes, versions, GitHub and Share are off with reasons; a symlink out is listed and never read; reads refused while sign-in is dark; no absolute path of the folder appears in any page, error body or log line (the redaction check); Remove ends access. No Git conversion. | P2 |
| AR-2 | Layout variants | Open a doc in `default`, `classic`, `editorial`, `review` and `guided` (Page details, and `?variant=` with the standalone names); the choice persists per device; each is usable at 412×915, 1280×800 and 1920×1080; each follows ccrc's appearance while hosted (theme and fonts through the appearance slots, as X1's merged contract defines them) and passes its contrast pairs. | P5 |
| AR-3 | Large files | Real fixtures at 2 MiB, 4 MiB and 64 MiB, one byte below, at and above each: Markdown in parts, an image view, Download; over 64 MiB the plain sentence and nothing partial; a draft above 4 MiB opens through its snapshot (the overlay-cap decision). Peak page memory measured on the phone. | P1 |
| AR-4 | PDFs | List, open inline and download one PDF below, at and above 4 MiB; no network from the frame or its worker; links do not navigate; phone and desktop. | P3 |
| AR-5 | Tracker links | Configure two rules in Settings; matching item ids link through the external-link sheet; a non-match stays text; a rule with a placeholder beside the host is refused; no tracker is named in the shipped code. | P4, P5 |
| AR-6 | Complete parity inventory | Run every row of the spec's §2 on both readers, side by side, on the same docs. Print (rows PR1 to PR11 of the spec's §4.6, with stage 2's drawn figures and the library's print mode), figure-overlay Back-to-close and Back from a jump, and the old-origin-state disposition (C1, as the operator rules it) are each evidenced explicitly. | All |

---

## Wave P1: range reads and large files

### Task P1.1: Range vocabulary and ceilings (L0)

**Files:** Modify `shared/docs.ts`; Test `server/test/docs-shared.test.ts`, `server/test/docs-parity.test.ts`.

**Interfaces:**
- Produces: `DOCS_RANGE_FRAME_BYTES`, `DOCS_RANGE_MAX_BYTES`, `DOCS_PDF_INLINE_MAX_BYTES`, `DOCS_IMAGE_VIEW_MAX_PIXELS`, `DOCS_RANGE_PREPARE_BUDGET_MS` (value set from lab RANGE-L1, Step 0); `type DocsRangePin = { kind: 'blob'; sha: Sha } | { kind: 'fp'; sha: Sha } | { kind: 'stat'; size: number; mtimeNs: string }`; `DocsEntry.draft.mtimeNs?: string` (additive, a decimal string of nanoseconds); `statPinOf(e: DocsEntry): DocsRangePin | null` (the one reader: absent or not decimal gives `null`); `EntryView.pin: DocsRangePin | null`; `interface DocsRangePrepared { snapshot: string; size: number; digest: Sha }`; `interface DocsRangeFrame { snapshot: string; offset: number; bytesB64: string; digest: Sha; total: number }`; range failure words `snapshot-gone`, `draft-changed`, `range-too-large`, `prepare-busy`.

- [ ] **Step 0: Lab RANGE-L1.** On a fixture HOME on the fleet box, time `cp` plus sha256 of a 64 MiB file five times; record median and worst in Results; set `DOCS_RANGE_PREPARE_BUDGET_MS` to three times the worst, at least 10000.
- [ ] **Step 1: Failing tests.** `docs-shared: range ceilings are their own literals` (each constant equals its spec value and none is an alias of another); `docs-parity: ccd range literals equal shared`.
- [ ] **Step 2: Run** `ccrc test -- ./node_modules/.bin/vitest run test/docs-shared.test.ts test/docs-parity.test.ts` from `server/`; expect FAIL (undefined).
- [ ] **Step 3: Add the constants, types and words** beside the caps block (B) and the failure vocabulary, each with its one-line reason.
- [ ] **Step 4: Run** the same; expect PASS. **Step 5: Commit** `feat(docs): range ceilings and vocabulary (X2 P1)`.

### Task P1.2: `ccd docs-show-range` with its snapshot cache

**Files:** Modify `ccd/ccd` (`_docs_py`: `cmd_docs_show_range`, `range_prepare`, `range_frame`, the cache), `agent/src/whitelist.ts` (grant `['docs-show-range','--project']`, `REQUIRED_VERB_FLAG`), `server/src/ccdargv.ts` (cap token `docs-range-v1`); `server/test/verb-gate.test.ts` (`CAP_GATED_VERBS` gains `docs-show-range`), `server/test/ccd-can-sites.test.ts` (the new `runCcd` call site in `ccdsource.ts`); Test `server/test/ccd-docs-range.test.ts` (new, `makeCcdHarness`, three poisons).

**Interfaces:**
- Produces: `ccd docs-show-range --project P --commit C --section S --path X --pin <blob:sha|fp:sha|stat:size:mtimeNs> --prepare` answering `DocsRangePrepared`; `… --snapshot ID --offset O --length L` answering `DocsRangeFrame`.
- Cache: ccd-owned `~/.cc-docs-range/` (never inside `$REG` or a swept temp root), mode 0700, one `flock`; every range call first removes expired entries under the lock; reserve-then-copy against 536870912 bytes, or a lower bound read from the cache directory's bound file (only ever lower); at most 2 prepares at once, 6 a minute; entries one hour, least recently used first; snapshot id bound to (project or label, section, path, pin).

- [ ] **Step 1: Failing tests** (each one `it`): `range: frames reassemble to the blob`; `range: a file changed since the listing refuses` (stat pin, then `touch`; expect `draft-changed`); `range: fp pin of a changed draft refuses`; `range: a frame naming another path's snapshot refuses`; `range: a frame of 524289 bytes refuses`; `range: files of 67108863 and 67108864 bytes prepare, 67108865 refuses range-too-large` (sparse fixtures, so the HOME holds no 64 MiB of written data); `range: a third concurrent prepare answers prepare-busy`; `range: a seventh prepare in a minute answers prepare-busy`; `range: an evicted snapshot answers snapshot-gone`; `range: cache never exceeds its bound` (the fixture HOME lowers the bound to 8 MiB with the bound file; two concurrent 5 MiB prepares; a hook pauses the first between reserve and copy; the second refuses `prepare-busy` and the directory never holds more than 8 MiB); `range: a bound file above the constant changes nothing`.
- [ ] **Step 2: Run** from `server/`; expect FAIL (`unknown verb`).
- [ ] **Step 3: Implement** the verb in `_docs_py`; the prepare reads a committed blob through the existing blob path, a draft through the existing fingerprinted read, and checks a `stat` pin against `os.fstat` of the opened descriptor.
- [ ] **Step 4: Run**; expect PASS. **Step 5: Commit** `feat(ccd): docs-show-range with a bounded snapshot cache (X2 P1, D-8764)`.

### Task P1.3: Server range route

**Files:** Modify `server/src/docs/{policy,ports,ccdsource,routes}.ts`, `server/src/server.ts` (only if the docs plugin's registration call changes), `server/test/box-token-census.test.ts` (`DOCS_DOORS` gains the range door), `server/test/auth-gate.test.ts` (the docs route count and its running total), `server/test/rings/fastify-l4.data.ts` (only for a new fastify-importing file); Test `server/test/docs-routes.test.ts`, `server/test/docs-policy.test.ts`, `server/test/docs-headers.test.ts`.

**Interfaces:**
- Consumes: P1.2's verb. Produces: `GET /api/docs/:project/range?section&path&commit&pin&prepare=1` and `…&snapshot&offset&length`; L1 `docsRangePlan(req): DocsRangePlan | DocsFailureBody`; L2 `DocsRangeRead`; registered inside the docs plugin.

- [ ] **Step 1: Failing tests:** `docs-routes: range prepare then frames`; `docs-routes: range without the docs marker is 403`; `docs-policy: range plan refuses length above DOCS_RANGE_FRAME_BYTES`; `docs-policy: no range for a ccd without docs-range-v1 (unsupported, zero execs)`; `docs-headers: range answers carry the base 5.3 headers`; `box-token-census: DOCS_DOORS is exactly what docs/routes.ts registers` (the existing case, with the range door added); `auth-gate: docs/routes.ts registers 6` (the existing count, and the running total, moved by one).
- [ ] **Step 2 to 4:** run (FAIL), implement, run (PASS). **Step 5: Commit** `feat(docs): range route (X2 P1)`.

### Task P1.4: PWA reassembly, Download and image view above 2 MiB

**Files:** Create `pwa/src/docs/range/{readRange.ts,rangePolicy.ts}`; Modify `pwa/src/docs/objectUrls.ts`, `pwa/src/docs/DocsLeaf.tsx`, `pwa/src/docs/DocImage.tsx`, `pwa/src/docs/docsText.ts`; Test `pwa/test/docs-range.test.ts` (new).

**Interfaces:**
- Produces: `readRange(loader, target, opts: { signal: AbortSignal; onProgress(done: number, total: number): void }): Promise<{ ok: true; blob: Blob } | { ok: false; why: DocsRangeFailure }>` (frames written into one buffer allocated from the prepare's size, then one `Blob`); L1 `rangeVerdict(size: number, cls: DocContentClass): 'show' | 'range' | 'over-ceiling'`; `imageHeaderDims(bytes: Uint8Array): { w: number; h: number } | null` (PNG IHDR, JPEG SOF, GIF, WebP).

- [ ] **Step 1: Failing tests:** `range reassembly: frames in order make the blob`; `range reassembly: one buffer, sized from the prepare, holds every frame`; `range reassembly: a frame with a bad digest fails the read`; `range reassembly: cancel drops every frame` (signal aborted mid-read, nothing saved, no further request); `range reassembly: snapshot-gone restarts from prepare once, then fails`; `rangeVerdict: below, at and above 2 MiB and 64 MiB`; `image view: 8192 by 8192 shows, 8192 by 8193 refuses before decode` (pixels below, at and above `DOCS_IMAGE_VIEW_MAX_PIXELS`, from headers only); `image view: 16384 by 4096 shows, 16385 by 1 refuses before decode` (the side limit); `over ceiling: the sentence names the size and the ceiling, no Download offered`.
- [ ] **Step 2 to 4:** run (FAIL), implement, run (PASS). **Step 5: Commit** `feat(docs): range reassembly, Download and image view above 2 MiB (X2 P1)`.

### Task P1.5: Markdown in parts, and the overlay cap

**Files:** Create `pwa/src/docs/range/mdParts.ts`; Modify `ccd/ccd` (the docs-tree draft entry's `mtimeNs`, from the leaf check's `lstat` `st_mtime_ns`), `pwa/src/docs/DocsLeaf.tsx`, `shared/docs.ts#entryView`, `shared/docs.ts#statPinOf`; Test `pwa/test/docs-md-parts.test.ts` (new), `server/test/docs-shared.test.ts`, `server/test/ccd-docs-tree.test.ts`.

**Interfaces:**
- Produces: `splitMarkdownParts(text: string, maxBytes: number): { parts: { start: number; end: number; continued: boolean }[] }` (cuts at top-level headings outside fences; a section above `maxBytes` cut at a blank line outside fences); part ids map `Map<string, number>` from the worker pre-pass; `entryView`: a regular draft file with `fp: null`, size at most `DOCS_RANGE_MAX_BYTES` and a readable `mtimeNs` now `opens: 'draft'` with `pin: { kind: 'stat', size, mtimeNs }`; without `mtimeNs` it stays withheld `too-large`.

- [ ] **Step 1: Failing tests:** `md parts: never cuts inside a fence`; `md parts: every part at most 2 MiB`; `md parts: a link into part 3 opens part 3`; `md parts: a part the budget refuses keeps its ids unknown and opens part 1 with a note`; `entryView: a 5 MiB draft opens through its snapshot`; `entryView: a 65 MiB draft stays withheld too-large`; `entryView: a draft without mtimeNs stays withheld (an older ccd)`; `docs-tree: a draft entry carries mtimeNs as a decimal string`.
- [ ] **Step 2 to 4:** run (FAIL), implement, run (PASS). **Step 5: Commit** `feat(docs): Markdown in parts and the overlay cap (X2 P1)`.

## Wave P2: outside folders

### Task P2.1: The registry and `docs-folder`

**Files:** Modify `shared/docs.ts` (`DOCS_FOLDER_LABEL_RE`), `server/test/docs-parity.test.ts` (ccd's copy equals it), `ccd/ccd` (`cmd_docs_folder`, the label check before any path join, admission), `agent/src/whitelist.ts` (`['docs-folder','--list']`, `['docs-folder','--add']`, `['docs-folder','--remove']`), `server/src/ccdargv.ts` (`docs-folders-v1`), `server/test/verb-gate.test.ts` (`CAP_GATED_VERBS` gains `docs-folder`), `server/test/ccd-can-sites.test.ts` (the list call site); Test `server/test/ccd-docs-folder.test.ts` (new).

**Interfaces:** Produces `DOCS_FOLDER_LABEL_RE = /^[a-z0-9][a-z0-9-]{0,31}$/` in `shared/docs.ts`, with ccd's parity copy; `ccd docs-folder --list` → `{ folders: { label: string; path: string }[] }`; `--add <label> --path <abs>` and `--remove <label>`; registry `$REG/docs-folders/<label>`, one writer, under the registry lock; Remove purges the label's range snapshots. Admission: `os.open` from `/` with `O_DIRECTORY|O_NOFOLLOW` per component; owned by the user; protected directories (spec §4.1 list) compared by `(st_dev, st_ino)` of each ancestor and descendant check.

- [ ] **Step 1: Failing tests:** one refusal per admission rule (`folder add: symlinked component refused`, `… inside the projects root refused`, `… a parent of the session registry refused`, `… the home directory refused`, `… a protected directory named through a symlinked HOME refused` (the fixture HOME is a symlink to its real directory; the folder is given by its real path under the protected `.config`, so a path-prefix comparison passes it), `protected comparison: a directory whose device and inode match a protected one refuses, whatever its path` (the pure comparison, given pairs), `… a file refused`, `… a foreign owner refused`); `folder add: refusal never echoes the path`; `folder add: a label outside the grammar refused by ccd` (`..`, `a/b`, `.x`, a control character, 33 characters, each before any path join); `folder remove: purges snapshots`; `docs-folder registry has one writer` (single-definition scan).
- [ ] **Step 2 to 4:** run (FAIL), implement, run (PASS). **Step 5: Commit** `feat(ccd): docs folder registry (X2 P2)`.

### Task P2.2: `docs-folder-read` and the walker

**Files:** Modify `ccd/ccd` (`cmd_docs_folder_read`, walker), `agent/src/whitelist.ts` (`['docs-folder-read','--label']`), `server/test/verb-gate.test.ts` (`CAP_GATED_VERBS` gains `docs-folder-read`), `server/test/ccd-can-sites.test.ts` (the read call sites); Test `server/test/ccd-docs-folder-read.test.ts` (new).

**Interfaces:** Produces `ccd docs-folder-read --label L --op tree` → `DocsFolderTreeOk { label; entries: { section; path; kind; size; mtimeNs: string; fp: Sha | null }[]; unlisted }` (the same `mtimeNs` as the docs-tree draft entry); `--op show --section S --path X --fingerprint F --max-bytes N`; `--op prepare|range` as P1.2 with the label in the bound tuple. Reads only the six section directories below the held folder descriptor, `O_NOFOLLOW` at every step.

- [ ] **Step 1: Failing tests:** `folder read: only the six sections list`; `folder read: a component swapped for a symlink after add refuses`; `folder read: docs/superpowers below the folder swapped for a symlink after add refuses`; `folder read: an escaping symlink is listed, never read`; `folder read: a FIFO is listed, never opened`; `folder read: a directory loop ends`; `folder read: dot components skipped`; `folder read: no absolute path in any answer` (scan of every answer shape); `folder range: a frame after remove refuses`.
- [ ] **Step 2 to 4:** run (FAIL), implement, run (PASS). **Step 5: Commit** `feat(ccd): docs-folder-read (X2 P2)`.

### Task P2.3: Server doors, dark refusal and census

**Files:** Modify `server/src/docs/routes.ts` (the folder handlers and their registrations; no new file under `server/src/docs`, so `docs-ring.test.ts`'s role table is unchanged), `server/src/docs/{policy,ports,ccdsource}.ts`, `server/src/server.ts` (only if the registration call changes), `server/test/box-token-census.test.ts` (`DOCS_DOORS` gains the seven folder doors), `server/test/auth-gate.test.ts` (the docs count and running total), `server/test/rings/fastify-l4.data.ts` (only for a new fastify-importing file), `server/test/single-definition/docs-ring.test.ts` (the paths read's one caller), `CLAUDE.md` (SAFETY: `docs-folder --add/--remove` forbidden to sessions; no census sentence), the five enforcement layers in their flag-qualified forms `docs-folder --add` and `docs-folder --remove` (`--list` stays open): `server/src/coord/approvalguard.ts#FORBIDDEN_CCD_VERBS`, `shared/api.ts#CHILD_DENY_CCD_VERBS`, `ccd/session-hook.sh` (both jq verb lists, a flag-qualified row as for `prune`), `ccd/install-session-hooks.sh` (its verb loop) and the direct-entry layer, which takes the whole verb `docs-folder` (`ccd/ccd-entry.py` and `ccd/ccd`'s own body guard); the tests that hold them, `server/test/{ccd-spawn-child-settings,session-hook-approval-deny,ccd-forbidden-verbs-entry,ccd-ws-lease-mark-reach}.test.ts`; Test `server/test/docs-folder-routes.test.ts` (new).

**Interfaces:** Produces `GET /api/docs-folders` (labels only), `GET /api/docs-folders/paths` (labels and paths, Settings only), `POST /api/docs-folders` `{label, path}`, `DELETE /api/docs-folders/:label`, `GET /api/docs-folders/:label/{tree,file,range}`, all inside the docs plugin; L1 `folderReadGate(signIn: 'dark' | 'armed', session: boolean): 'allow' | 'auth-off' | 'unauthenticated'`.

- [ ] **Step 1: Failing tests:** `folder doors: every read refuses auth-off while dark`; `folder doors: add needs the step-up and refuses dark`; `folder doors: remove works dark`; `folder doors: a label outside the grammar is refused before any exec`; `folder doors: missing docs marker is 403`; `folder: removed while open` (tree read after remove answers `unknown-folder`); `box-token-census: DOCS_DOORS is exactly what docs/routes.ts registers` (the folder doors added); `auth-gate: docs/routes.ts route count` (moved by seven); `folder doors: GET /api/docs-folders answers labels only, never a path`; `docs-ring: only DocsFoldersSection.tsx calls the paths read`; `approval guard: docs-folder --add and --remove are forbidden on a session's prompt, --list is not`; `child deny: CHILD_DENY_CCD_VERBS equals FORBIDDEN_CCD_VERBS` (the existing case, with the two forms added); `session hook: docs-folder --add is denied in a child, docs-folder --list is not`; `direct entry: docs-folder in any form refuses entry-unprivileged outside the installed direct entry` (what the layer proves: it starts the verb only under the installed entry, whatever the flags).
- [ ] **Step 2 to 4:** run (FAIL), implement, run (PASS). **Step 5: Commit** `feat(docs): outside folder doors (X2 P2)`.

### Task P2.4: Settings and folder pages

**Files:** Create `pwa/src/screens/settings/DocsFoldersSection.tsx`; Modify `pwa/src/screens/settings/SettingsIndex.tsx`, `pwa/src/docs/{DocsIndexView.tsx,DocsTreeView.tsx,docsTree.ts,docsLinks.ts,DocsBanners.tsx,DocsHead.tsx}` (in `DocsHead.tsx`, the truth line and the five actions' off reasons only, claimed only while no X1 wave holds it; its other areas stay X1's), `shared/docs.ts#parseDocsPage` (`~<label>`); Test `pwa/test/docs-folders.test.tsx` (new).

- [ ] **Step 1: Failing tests:** `parseDocsPage: ~label is a folder, never a project`; `folder page: truth line says Not in a repository with the file's modified time`; `folder page: history, changes, versions, GitHub and Share are off with their reasons`; `index: folders listed after projects`; `settings: add and remove round trip, refusal reason shown`.
- [ ] **Step 2 to 4:** run (FAIL), implement, run (PASS). **Step 5: Commit** `feat(docs): outside folders in Settings and Docs (X2 P2)`.

## Wave P3: PDF frame

### Task P3.1: The `pdf` class and the dependency decision

**Files:** Modify `shared/docs.ts` (`DOC_CONTENT_CLASS_MAP`, `DOC_CONTENT_CLASS_BY_EXT`, `DOCS_CLASS_CAP`, `sniffPdf`, `pdfVerdict`), `pwa/package.json` and lock, the shipped third-party notices; Test `server/test/docs-shared.test.ts`, `pwa/test/pdf-dependency.test.ts` (new).

- [ ] **Step 0:** Choose the newest `pdfjs-dist` release; record version, integrity, provenance and `npm audit signatures` output in Results.
**Interfaces:** Produces `pdfVerdict(size: number): 'inline' | 'download'` (L1, pure, against `DOCS_PDF_INLINE_MAX_BYTES`), which `DocsLeaf.tsx`'s pdf branch (P3.2) consults.

- [ ] **Step 1: Failing tests:** `pdfVerdict: 4194303 and 4194304 bytes inline, 4194305 download only`; `contentClass: .pdf is pdf`; `sniffPdf: %PDF- at 0 matches, else mismatch`; `pdf dependency: exact pin, no caret`; `pdf dependency: notice present`.
- [ ] **Step 2 to 4:** run (FAIL), implement, run (PASS). **Step 5: Commit** `feat(docs): pdf class and pdfjs-dist pin (X2 P3)`.

### Task P3.2: `PdfFrame`

**Files:** Create `pwa/src/docs/pdf/{PdfFrame.tsx,pdfPolicy.ts,pdfSrcdoc.ts}`; Modify `pwa/src/docs/DocsLeaf.tsx`; Test `pwa/test/pdf-frame.test.tsx` (new), browser `pwa/browser/pdf-frame.browser.test.ts` (new).

**Interfaces:** Produces `PDF_SANDBOX = 'allow-scripts'`; `pdfCsp(hashes: string[]): string` (spec §4.4 tokens, no `'unsafe-eval'`, no `'wasm-unsafe-eval'`); `buildPdfSrcdoc({ pdfB64, viewer, worker, fonts, cmaps }): string` with the CSP meta first and the click guard second; `<PdfFrame bytes>` mounts once, tears down on a second `load`.

- [ ] **Step 1: Failing tests:** `pdf frame: sandbox is exactly allow-scripts`; `pdf frame: csp tokens pinned, no eval sources`; `pdf frame: meta first, guard second`; `pdf frame: no MessageChannel, postMessage or message listener in pwa/src/docs/pdf` (source scan); browser: `pdf frame: link annotation does not navigate`, `pdf frame: forced navigation tears down once`, `pdf frame: JavaScript and Launch actions do nothing`, `pdf frame: worker has no network`.
- [ ] **Step 2 to 4:** run (FAIL), implement, run (PASS). **Step 5: Commit** `feat(docs): isolated PDF frame (X2 P3)`.

### Task P3.3: Labs PDF-L1 to PDF-L3 and the ceiling

- [ ] **Step 1:** Run PDF-L1 (blob worker in an opaque origin, inherited policy), PDF-L2 (srcdoc at 4 MiB with viewer, worker, fonts and CMaps) and PDF-L3 (a JPEG 2000 image) on desktop Chromium and Firefox in the browser harness; record each in Results; phone engines go to F's device item.
- [ ] **Step 2:** If PDF-L2 fails at 4 MiB, lower `DOCS_PDF_INLINE_MAX_BYTES` to the largest size it passes, move P3.1's three sizes with it (one byte below, at, one byte above), and report it. **Step 3: Commit** `test(docs): PDF labs (X2 P3)`.

## Wave P4: listings, refs and the docs settings store

### Task P4.1: Index newest five, the project page's docs and readable titles

**Files:** Modify `ccd/ccd` (`docs-index --all`), `shared/docs.ts` (`DocsIndexOk.projects[].newest?`, `newestTruncated?`), `pwa/src/docs/{DocsIndexView.tsx,DocsTreeView.tsx,docsTree.ts}`; Test `server/test/ccd-docs-index.test.ts`, `pwa/test/docs-titles.test.ts` (new).

**Interfaces:** Produces `docTitle(name: string): { title: string; date: string | null }` (L1, `docsTree.ts`).

- [ ] **Step 1: Failing tests:** `project page: each section lists its docs with title, date label and draft badge, newest first` (from the tree answer, no extra request); `index: at most five newest per section`; `index: at the wire cap names drop from the last project, counts kept, newestTruncated set`; `index: an answer without newest renders`; `docTitle: table of names` (date prefix, extension, `-` and `_`).
- [ ] **Step 2 to 5:** run, implement, run, commit `feat(docs): newest docs and readable titles (X2 P4)`.

### Task P4.2: Old ref spellings and `.ico`

**Files:** Modify `ccd/ccd` (resolver: `refs/tags/<t>`, a bare tag name after the branches, 7 to 64 hex commits), `shared/docs.ts` (`parseDocsPage`, `DOCS_RASTER_TYPES` `ico` with count and offset checks); Test `server/test/ccd-docs-ref.test.ts` (new, `makeCcdHarness`, three poisons), `server/test/docs-shared.test.ts`, `server/test/docs-url.test.ts`.

- [ ] **Step 1: Failing tests:** `ref: origin/b reads refs/remotes/origin/b unless a local origin/b exists`; `ref: refs/tags/t opens at its commit`; `ref: a bare tag name with no branch of that name opens at the tag's commit` (an annotated tag peeled); `ref: a name that is both a branch and a tag opens the branch`; `ref: a unique short commit opens at= the full commit`; `ref: an ambiguous short commit refuses`; `ico: magic with a bad count or offset is a mismatch`.
- [ ] **Step 2 to 5:** run, implement, run, commit `feat(docs): old ref spellings and ico (X2 P4)`.

### Task P4.3: `docs_settings` and its doors

**Files:** Create `shared/docsTracker.ts` (L0); Modify `server/src/docs/routes.ts` (the two settings handlers and their registrations, reaching `coord.db` through two functions `composeDocs` takes), `server/src/server.ts` (passes `CoordStore#readDocsSettings` and `#writeDocsSettings` to `composeDocs`), `server/src/coord/{schema,store}.ts` (one migration, `CoordStore#readDocsSettings` and `#writeDocsSettings`), `server/test/box-token-census.test.ts` (`DOCS_DOORS` gains the two settings doors), `server/test/auth-gate.test.ts` (the docs count and running total), `server/test/rings/fastify-l4.data.ts` (only for a new fastify-importing file); Test `server/test/docs-tracker.test.ts` (new), `server/test/docs-settings-routes.test.ts` (new).

**Interfaces:** Produces `interface TrackerRule { name: string; pattern: string; template: string; projects?: string[] }`; `checkTrackerRule(r): { ok: true } | { ok: false; why: 'pattern-long' | 'pattern-empty-match' | 'pattern-invalid' | 'template-scheme' | 'template-host' | 'too-many' }`; `resolveItemLink(rules, project, value): string | null` (imported only by P5.2's tracker job; `checkTrackerRule` tests a pattern against the empty string only); `settingsWidening(before, after): boolean`; `GET /api/docs/settings`, `PUT /api/docs/settings`.

- [ ] **Step 1: Failing tests:** `tracker: placeholder beside the host refused`; `tracker: http template refused`; `tracker: pattern matching empty refused`; `tracker: 201-character pattern refused`; `tracker: 21 rules refused`; `tracker: capture with / and ? is percent-encoded`; `settings: a widening PUT needs the step-up and refuses dark`; `settings: a removing PUT works dark`; `box-token-census: DOCS_DOORS is exactly what docs/routes.ts registers` (the settings doors added); `auth-gate: docs/routes.ts route count` (moved by two); the migration's hidden pins (run the `coord.db` migration census suites; see the census note in Results).
- [ ] **Step 2 to 5:** run, implement, run, commit `feat(docs): docs settings store and tracker rules (X2 P4)`.

### Task P4.4: Settings UI, default branch and the no-tracker scan

**Files:** Create `pwa/src/screens/settings/DocsSettingsSection.tsx`; Modify `pwa/src/screens/settings/SettingsIndex.tsx`, `pwa/src/docs/docsLinks.ts`, `server/test/single-definition/docs-l0.test.ts` (the no-tracker scan, in the docs area file); Test `pwa/test/docs-settings.test.tsx` (new).

- [ ] **Step 1: Failing tests:** `settings: rules round trip with refusal reasons`; `default branch: listing links carry ?ref when set, a gone branch falls back with a note`; `no tracker host in pwa/src, server/src, shared or the pinned library's defaults`.
- [ ] **Step 2 to 5:** run, implement, run, commit `feat(docs): docs settings in Settings (X2 P4)`.

## Wave P6: Print stage 1 and the in-walls page loader

### Task P6.1: Print stage 1

**Files:** Create `pwa/src/docs/print/{PrintView.tsx,printTree.ts}`, `pwa/src/lib/printAllow.ts` (L1, imported statically by the render job); Modify `pwa/src/lib/readerRenderJob.ts` (a render job with `print: true` answers the allow-listed tree beside its html, reusing its own render outcome, so there is one render path), `pwa/package.json` and lock (the HTML parser), `pwa/test/markdown-purity.test.ts` (`ALLOWED_PACKAGES` gains the parser; the dynamic `import()` list stays `['./readerRenderJob']`), `pwa/test/markdown-worker-built.test.ts` (still exactly one chunk holds the renderer, the parser with it), `pwa/test/markdown-runner.test.ts` (the render job's message gains `print`), `pwa/src/docs/DocsHead.tsx` (Print row in Page details), `pwa/src/docs/docs.css` (`@media print`); Test `pwa/test/docs-print.test.tsx` (new), `pwa/test/print-tree.test.ts` (new), browser `pwa/browser/docs-print.browser.test.ts` (new).

**Interfaces:** Produces, in `readerRenderJob.ts`, `ReaderRenderJob` gaining `print?: true`, whose `rendered` answer then carries `printTree: PrintTree` made from the same render outcome by the HTML parser and `printAllow(tree): PrintTree` (L1, pure: the spec §4.6 allow-list, elements and attributes by name); `preparePrintTree(doc, runner): Promise<PrintTree | null>` (started after the reader's `ready`, parse budgets apply); `<PrintView tree figures?>` (React only, never `dangerouslySetInnerHTML`); `PRINT_WAIT_MS = 10000`.

- [ ] **Step 0: The parser dependency.** Choose one HTML-to-tree parser that runs in a worker without a DOM (`hast-util-from-html`, parse5-based, is the default choice); record version, integrity, provenance, `npm audit signatures` and its import list in Results; exact pin, no caret.

- [ ] **Step 1: Failing tests:** `print tree: the allow-list drops style, handlers and foreign URLs` (a fixture holding `style`, `onclick`, an `href` to another origin, `srcset` and an `svg` element: each gone, its text kept); `print tree: details open, sup, sub, kbd and comment anchors are elements` (the PR2 blocks, from the render output); `print tree: every id is prefixed and in-doc links follow` (a heading id `location` and an anchor `id:top` become `docs-print-location` and `docs-print-top`, and `#top` links to the second); `print tree: a class outside the library's vocabulary is dropped`; `print tree: the class vocabulary equals the classes the library's conformance output emits`; `print view: no dangerouslySetInnerHTML in pwa/src/docs/print` (source scan); `print: tree parsed only after ready, never on the main thread`; `print: beforeprint mounts from the prepared tree, afterprint unmounts`; `print: Ctrl+P before the tree is ready prints the one-line page`; `print: figures print as source with caption`; `print: no allow-modals anywhere` (existing token scans stay green); browser: `print: page.pdf holds every PR1 and PR2 block of the fixture` (Chromium); `print: under print media the frame and console chrome are not rendered` (print media emulated; the frame, the bar and the rail each have computed `display: none`, and the page's PDF has no frame box).
- [ ] **Step 2 to 5:** run, implement, run, commit `feat(docs): Print from ccrc's window (X2 P6)`.

### Task P6.2: Sibling modules, import maps and fetch within the walls

**Files:** Create `pwa/src/docs/mockup/shim.ts`; Modify `pwa/src/docs/mockup/{load,plan}.ts`; Test `pwa/test/mockup-loader.test.ts` (new), browser `pwa/browser/mockup-loader.browser.test.ts` (new).

- [ ] **Step 1: Failing tests:** `loader: a two-module graph renders`; `loader: an import map naming siblings renders`; `loader: an import map naming https asks Load external`; `loader: an import map naming data: is refused`; `loader: a sibling fetch answers from the set, others fail`; `loader: a page over 5 MiB shows Download and Source with the reason`; `loader: MOCKUP_SANDBOX_SCRIPTED, MOCKUP_CSP and the click guard unchanged` (pins).
- [ ] **Step 2 to 5:** run, implement, run, commit `feat(docs): in-walls page loader (X2 P6)`.

## Wave P5: the reading layer (after the library release)

### Task P5.1: Adopt the release; layouts

**Files:** Modify `pwa/package.json` and lock, `pwa/src/docs/reader/{bridge,policy}.ts`, `pwa/src/docs/ReaderFrame.tsx`, `pwa/src/docs/DocsHead.tsx` (Layout row), `docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md` §3.3; Test `pwa/test/reader-layouts.test.ts` (new), browser `pwa/browser/reader-layouts.browser.test.ts` (new).

**Interfaces:** Produces `type ReaderLayout = 'default' | 'classic' | 'editorial' | 'review' | 'guided'`; `layoutFromVariant(v: string | null): ReaderLayout` (`AB`→default, `A`→editorial, `B`→review, `C`→guided, `classic`→classic, else default); pref key `ccrc:reader:v1:pref:prefs` gains `layout`.

- [ ] **Step 1: Failing tests:** `layouts: variant names map`; `layouts: pref persists per device and ?variant overrides one visit`; `layouts: ?variant carries on doc links`; `layouts: each layout's srcdoc, with X1's fonts, stays under its cap`; browser: one row per layout per width (one bar, no horizontal scroll, contents reachable, ccrc's appearance applied in light and dark).
- [ ] **Step 1a: The library's own proof, recorded.** Copy into Results the release's conformance and appearance contrast suite results per layout; a layout without both is not adopted.
- [ ] **Step 2 to 4:** run, implement, run.
- [ ] **Step 5: Amend rich-docs §3.3.** Replace "The standalone server's other layouts: the design-prototype variants and the old `classic` layout. Only the default layout ships." with "The standalone server's other layouts ship as library layouts beside the default: `classic`, `editorial`, `review` and `guided` (amended <date>; X2 P5, D-8762)."
- [ ] **Step 6: Commit** `feat(docs): reader layouts (X2 P5, D-8762)`.

### Task P5.2: Tracker links through the worker

**Files:** Create `pwa/src/lib/trackerLinkJob.ts` (imported statically by `readerRenderJob.ts`, never through a new `import()`); Modify `pwa/src/lib/readerRenderJob.ts` (the static import), `pwa/src/lib/markdownWorker.ts` (dispatch `kind: 'tracker-links'` into the render chunk it already loads), `pwa/src/lib/markdownRunner.ts` (`docsRunner` posts it after the render answers, and starts its budget at the worker's acknowledgement), `pwa/test/markdown-purity.test.ts` (`SHARED_FILES` gains `shared/docsTracker.ts`; the dynamic `import()` list unchanged), `pwa/test/markdown-runner.test.ts` (the job's shape and its acknowledgement), `pwa/test/markdown-worker-built.test.ts`, `pwa/src/lib/readerLimits.ts` (`TRACKER_MATCH_BUDGET_MS = 250`), `pwa/src/docs/reader/bridge.ts` (links into the seed), `server/test/single-definition/docs-ring.test.ts`; Test `pwa/test/reader-tracker.test.ts` (new).

**Interfaces:** Produces `answerTrackerJob(job: { id: number; kind: 'tracker-links'; project: string; values: string[]; rules: TrackerRule[] }): { id: number; links: { value: string; href: string }[] }`; the runner answers `timeout` past `TRACKER_MATCH_BUDGET_MS`, and the console then seeds no links and mounts the rendered doc.

- [ ] **Step 1: Failing tests:** `tracker: matching item links in the seed`; `tracker: non-match stays text`; `tracker: (a+)+ against 100 a and a b ends in the 250 ms job budget, the doc rendered, items as text`; `tracker: a matching timeout keeps the rendered doc, never the plain view`; `tracker: on a cold worker the budget starts after the chunk is loaded`; `docs-ring: resolveItemLink is imported only by trackerLinkJob.ts`; `tracker: at most 50 values of 100 characters`.
- [ ] **Step 2 to 5:** run, implement, run, commit `feat(docs): tracker links (X2 P5)`.

### Task P5.3: Back places

**Files:** Create `pwa/src/lib/historyPlaces.ts` (the L1 decider and its index rule), `pwa/src/docs/reader/places.ts` (the reader's reporting of places to it); Modify `pwa/src/lib/router.ts` (its one `popstate` path consults the decider before setting the location; the unwind before an in-app navigation away from a visit with places), `pwa/src/docs/ReaderFrame.tsx`, `pwa/src/docs/readerHistory.ts`, rich-docs spec §4.4; Test `pwa/test/reader-places.test.ts` (new), browser `pwa/browser/reader-places.browser.test.ts` (new).

**Interfaces:** Produces `decidePop(popped: unknown, tab: { visit: string | null; places: Place[]; pendingSeq: number | null; lastIdx: number }): { kind: 'close-overlay' } | { kind: 'goto'; id: string; from?: string } | { kind: 'consume' } | { kind: 'skip'; dir: 'back' | 'forward' } | { kind: 'router' }`, consulted by `router.ts` before it sets the location on every `popstate`; `unwindBefore(navigate: () => void): void` (one `history.go(-n)` for the current visit's places, then the navigation); `docsIdx` on every stamped entry, the tab's counter and `lastIdx` in session storage; `PLACES_MAX = 50` per doc visit; a pushed entry's URL is `location.href` unchanged.

- [ ] **Step 0: Precondition, lab E16 per engine** (desktop Chromium and Firefox in the harness; phones in F): does a tap in the frame give the console activation for `pushState`? Record; where it fails, the row is recorded failed for that engine, and Esc and Close still work.
- [ ] **Step 1: Failing tests:** the spec §4.7 list (`places: overlay Back closes it`, `places: Esc then exactly one Back consumed`, `places: a hash with push pushes an entry, and Back sends goto with its id and its from token`, `places: a real jump's from token passes the parser` (a token made by the library's own `tokenOf`), `places: a hash without push still replaces`, `places: a hash whose from fails the library's anchor grammar or passes 4096 characters is refused by the parser`, `places: 51 places push 50`, `places: a remount of the same doc keeps the visit's budget`, `places: stale places after navigating away cost no extra Back`, `places: leaving a doc by a link unwinds its places first`, `places: Forward after Back from B reaches B`, `places: after a reload, stale places are skipped in both directions`, `places: Back from a screen that is not a doc into stale places costs one Back`, `places: the pushed entry's URL is the doc's current URL`, `places: an entry with no docsPlace goes to the router`, `places: router synthetic popstate not consumed`, `places: pushed entry keeps only`, `places: the port nonce never reaches history.state`, `places: place with a URL refused by the parser`).
- [ ] **Step 2 to 4:** run, implement, run.
- [ ] **Step 5: Amend rich-docs §4.4.** In the `hash` row, after "The parent calls `replaceState` with the fragment", add "; a `place` pushes an entry instead (amended <date>; X2 P5, D-8763)"; in the `command` row, after "Sent only from a tap on ccrc's own bar", add ", or on a Back that pops a place, for `close-overlay` and `goto` (amended <date>; X2 P5, D-8763)"; add rows for `place`, `close-overlay`, `goto`.
- [ ] **Step 6: Commit** `feat(docs): Back closes the overlay and returns from a jump (X2 P5, D-8763)`.

### Task P5.4: Reading-layer flags

**Files:** Modify `pwa/src/docs/reader/{bridge,policy}.ts`, `pwa/src/docs/readerHistory.ts` (the comparison base per doc in session storage, under `ccrc:reader:v1:`); Test `pwa/test/reader-flags.test.ts` (new).

- [ ] **Step 1: Failing tests:** `flags: rules on in the seed`; `flags: addressees you and operator, qualifiers`; `flags: In short switch on`; `flags: reload keeps the comparison base`; `flags: a link back to the doc keeps the comparison base in this tab`; `flags: another tab starts without it`.
- [ ] **Step 2 to 5:** run, implement, run, commit `feat(docs): reading-layer flags (X2 P5)`.

### Task P5.5: Print stage 2, drawn figures

**Files:** Modify `pwa/src/docs/print/**`, `pwa/src/lib/readerRenderJob.ts` (asks `render` for its print mode when `print` is set), `pwa/src/docs/reader/bridge.ts`; Test `pwa/test/docs-print-figures.test.ts` (new), `pwa/test/print-tree.test.ts`; lab PRINT-L1.

**Interfaces:** Produces `checkFigurePng(b64: string): Promise<{ ok: true; blob: Blob } | { ok: false; why: 'not-png' | 'too-large' | 'too-wide' | 'decode' }>` (in this order: signature; at most 1 MiB; width and height from IHDR through P1.4's `imageHeaderDims`, each at most 2048; only then `createImageBitmap`; the decoded size checked against the header's; re-encode on a console canvas); caps 64 figures and 16 MiB.

- [ ] **Step 0: Lab PRINT-L1:** a 30-figure document's print-mode draw on desktop and phone; record; if out of line, stop and report the numbers to the coordinator.
- [ ] **Step 1: Failing tests:** `print mode: facts, byline and reading time, In short and Where things stand boxes, section numbers, status labels and the review strip's counts print` (one assertion per spec §4.6 row PR3 to PR8, from the library's print mode, through the same allow-list); `print mode: the library's scoped print stylesheet is loaded under the print root only`; `print figures: non-PNG refused`; `print figures: 1 MiB plus one refused before decode`; `print figures: a PNG declaring 4096 px is refused before createImageBitmap` (a spy on `createImageBitmap`, a PNG under 1 MiB whose IHDR declares 4096 by 4096: the spy is never called); `print figures: a decoded size that differs from the header refuses`; `print figures: 65th refused`; `print figures: 64 figures sent at 16 a second all arrive within PRINT_WAIT_MS under BRIDGE_LIMITS` (a fake clock: about 4 s, none refused by the bucket); `print figures: missing after 10 s prints source with the note`; `print figures: images are blob: URLs of re-encoded bytes`.
- [ ] **Step 2 to 5:** run, implement, run, commit `feat(docs): drawn figures in print (X2 P5)`.

## Mutation rows

Each row ships with the task that owns it; the row is red when the guard is removed and green when restored. Run through the coordinator's mutation runner.

| Row | Task | Mutation | Red test |
|---|---|---|---|
| M11.1 | P2.1 | Drop `O_NOFOLLOW` from one admission component | folder add: symlinked component refused |
| M11.2 | P2.2 | Walk by path string instead of the held descriptor | folder read: docs/superpowers below the folder swapped for a symlink after add refuses |
| M11.3 | P2.1 | Compare protected directories by path prefix | folder add: a protected directory named through a symlinked HOME refused |
| M11.4 | P2.2 | Stop skipping dot components | folder read: dot components skipped |
| M11.5 | P2.2 | Put the root path in the tree answer | folder read: no absolute path in any answer |
| M11.6 | P2.3 | Delete the dark refusal in `folderReadGate` | folder doors: every read refuses auth-off while dark |
| M11.7 | P5.1 | Map `B` to `default` | layouts: variant names map |
| M11.8 | P5.1 | Stop writing the `layout` pref | layouts: pref persists per device |
| M11.9 | P5.1 | Drop `?variant` from doc links | layouts: ?variant carries on doc links |
| M11.10 | P1.2 | Accept a frame of 524289 bytes | range: a frame of 524289 bytes refuses |
| M11.11 | P1.2 | Skip the `fstat` check of a stat pin | range: a file changed since the listing refuses |
| M11.12 | P1.2 | Drop the path from the snapshot binding | range: a frame naming another path's snapshot refuses |
| M11.13 | P1.4 | Skip the per-frame digest check | range reassembly: a frame with a bad digest fails |
| M11.14 | P1.2 | Skip reserve-then-copy | range: cache never exceeds its bound |
| M11.15 | P1.4 | Keep frames after abort | range reassembly: cancel drops every frame |
| M11.16 | P3.2 | Add `allow-popups` to `PDF_SANDBOX` | pdf frame: sandbox is exactly allow-scripts |
| M11.17 | P3.2 | Add `'wasm-unsafe-eval'` to `pdfCsp` | pdf frame: csp tokens pinned, no eval sources |
| M11.18 | P3.2 | Drop the click guard | pdf frame: link annotation does not navigate |
| M11.19 | P3.2 | Reload on a second load | pdf frame: forced navigation tears down once |
| M11.20 | P4.3 | Allow `http:` templates | tracker: http template refused |
| M11.21 | P5.2 | Run matching inside the render job | tracker: a matching timeout keeps the rendered doc, never the plain view |
| M11.22 | P4.3 | Skip the sentinel host check | tracker: placeholder beside the host refused |
| M11.23 | P4.4 | Add a tracker host to a default | no tracker host in the shipped code |
| M11.24 | P6.1 | Parse the print tree in `beforeprint` | print: tree parsed only after ready |
| M11.25 | P6.1 | Leave the frame visible under print media | print: under print media the frame and console chrome are not rendered |
| M11.26 | P6.1 | Unmount skipped on afterprint | print: beforeprint mounts, afterprint unmounts |
| M11.27 | P5.3 | Count "ignore next popstate" | places: router synthetic popstate not consumed |
| M11.28 | P5.3 | Write the port nonce into the pushed entry's state | places: the port nonce never reaches history.state |
| M11.29 | P5.3 | Raise `PLACES_MAX` to unbounded | places: 51 places push 50 |
| M11.30 | P5.3 | Drop `only` from pushed entries | places: pushed entry keeps only |
| M11.31 | P6.2 | Resolve a `data:` import map entry | loader: an import map naming data: is refused |
| M11.32 | P6.2 | Answer a non-sibling fetch | loader: a sibling fetch answers from the set |
| M11.33 | P6.2 | Add `connect-src` to `MOCKUP_CSP` | loader: MOCKUP_CSP unchanged |
| M11.34 | P4.1 | Keep names past the wire cap | index: at the wire cap names drop |
| M11.35 | P4.1 | Keep the date prefix in the title | docTitle: table of names |
| M11.36 | P4.2 | Resolve an ambiguous short commit | ref: an ambiguous short commit refuses |
| M11.37 | P4.4 | Ignore the default branch | default branch: listing links carry ?ref |
| M11.38 | P4.2 | Skip the ico count check | ico: bad count is a mismatch |
| M11.39 | P5.4 | Seed `rules` off | flags: rules on in the seed |
| M11.40 | P5.4 | Seed addressees `['you']` | flags: addressees you and operator |
| M11.41 | P5.4 | Drop the comparison base on reload | flags: reload keeps the comparison base |
| M11.42 | P5.5 | Accept a non-PNG | print figures: non-PNG refused |
| M11.43 | P5.5 | Decode before the size check | print figures: 1 MiB plus one refused before decode |
| M11.44 | P5.5 | Use the frame's bytes without re-encoding | print figures: images are re-encoded |
| M11.45 | P5.5 | Wait without a deadline | print figures: missing after 10 s prints source |
| M11.46 | P6.1 | Let `style` through `printAllow` | print tree: the allow-list drops style, handlers and foreign URLs |
| M11.47 | P4.1 | Draw the project page's section rows without their docs | project page: each section lists its docs |
| M11.48 | P4.2 | Resolve a bare name to the tag before the branches | ref: a name that is both a branch and a tag opens the branch |
| M11.49 | P5.3 | Skip the unwind before an in-app navigation away from a visit | places: leaving a doc by a link unwinds its places first |
| M11.50 | P5.2 | Import `resolveItemLink` from the render job | docs-ring: resolveItemLink is imported only by trackerLinkJob.ts |
| M11.51 | P1.5 | Default a missing `mtimeNs` to `"0"` in `statPinOf` | entryView: a draft without mtimeNs stays withheld |
| M11.52 | P5.5 | Check the dimensions only after decode | print figures: a PNG declaring 4096 px is refused before createImageBitmap |
| M11.53 | P1.2 | Move ccd's parity copy of `DOCS_RANGE_MAX_BYTES` down by one | range: files of 67108863 and 67108864 bytes prepare |
| M11.54 | P3.1 | Move `DOCS_PDF_INLINE_MAX_BYTES` down by one | pdfVerdict: 4194304 bytes inline |
| M11.55 | P1.4 | Move `DOCS_IMAGE_VIEW_MAX_PIXELS` down by one | image view: 8192 by 8192 shows |
| M11.56 | P2.3 | Drop `docs-folder --add` from the hook's jq verb lists | session hook: docs-folder --add is denied in a child |
| M11.57 | P5.3 | Skip stale places toward Back whatever the direction of travel | places: Forward after Back from B reaches B |
| M11.58 | P2.1 | Drop ccd's own label check, trusting the server's | folder add: a label outside the grammar refused by ccd |
| M11.59 | P6.1 | Admit an id unprefixed | print tree: every id is prefixed and in-doc links follow |

## Deviations found

- **D-8762 (2026-11-18)** — library-layouts-reconcile-1418. Wave P5 (Task P5.1): the shared library ships the standalone reader's other layouts (`classic`, `editorial`, `review`, `guided`) beside the default, and ccrc lets you pick one per device or per visit. Departs from rich-docs spec §3.3: "The standalone server's other layouts: the design-prototype variants and the old `classic` layout. Only the default layout ships." It carries out your later ruling of 2026-10-25 (#1418, layout variants kept), which overrides that earlier sentence and which the amended §6 row already states ("A follow-on design says how the reader offers every kept variant"), so it is a reconciliation you have already ruled, not a new departure from an operator decision. Wave P5 amends §3.3's text when it ships the layouts (Task P5.1 Step 5). Issued to run 2632 (X2) in its brief's block 8762 to 8764.
- **D-8763 (2026-11-18)** — reader-history-places. Wave P5 (Task P5.3): the reader frame reports places (`place` for the figure overlay, and its existing `hash` marked `push` for a jump) and the console pushes history entries for them, and sends `close-overlay` or `goto` when Back pops one. Departs from rich-docs spec §4.4: the `hash` row's "The parent calls `replaceState` with the fragment", the `command` row's "Sent only from a tap on ccrc's own bar, through the library's `DocFrame.command`, which focuses the frame first and sends nothing before `ready`", and the closed command list "`jump`, `settings`, `contents` or `outline`". Argued against the checked-bridge boundary: one op, two additive fields on the existing `hash` op (`push`, and `from`, the library's own checked anchor token) and two command names on the existing port, under the existing parser and limits; no new channel, no window listener, no parent-DOM access; the frame never sends a URL and the console builds every entry (threat note: spec §4.7). Wave P5 amends §4.4 (Task P5.3 Step 5). Issued to run 2632 (X2).
- **D-8764 (2026-11-18)** — range-frames-from-one-snapshot. Wave P1 (Task P1.2): each `docs-show-range` frame is read from one snapshot taken under the pin check, bound to the doc, and carries its own digest, instead of re-hashing the pinned file per frame. Departs from base spec §6.9: "It returns a file in bounded frames (at most 512 KiB of raw bytes each), each re-verified against the same blob or `fp`, so no single frame can hold the socket for long." It also answers a cost base spec §6.7 lists for chunking, "per-chunk re-verification;": each frame is verified against its own digest, from the snapshot. Re-hashing up to 64 MiB per frame would cost up to 128 whole-file hashes per read; the snapshot is named by its digest and every frame is checked against it (spec §4.3). Issued to run 2632 (X2); the block is spent.

## Results

### What was read and measured (2026-11-18)

- The standalone reader's source on the fleet box, behaviour only (its request handler, its page script's 27 parts, its four other layouts, stylesheet and theme script); its configuration was not read. The native reader at `main` `6f5421139`; the library 1.1.0 installed in a sibling workspace, read only.
- Three Sonnet · medium fact checks (client page script, layouts, server and files): 70 client rows, 34 server rows and a five-layout report, folded into the spec's 55 rows. Their reports stayed in the session's temp directory; every row they carried is in the spec's §2 with its proof.
- Counts on the fleet box over the six section directories of the projects under the projects root: largest file 52 030 856 bytes; 143 files above 2 MiB, 99 above 4 MiB; no PDF; 16 HTML pages, classified by wall in spec §4.8.
- One Opus · high adversarial review of the spec: 1 critical, 12 important and 11 minor findings. All 24 were fixed in the spec before this push: folder reads refuse while sign-in is dark; the print tree is parsed ahead; files without a fingerprint are pinned by size and modified time; the snapshot cache is bound, locked and rate-limited, with a separate prepare step and budget; folder admission is by file descriptors with a wider protected list; one new read verb keeps every existing grant unchanged; tracker matching moved to the parse worker, and placeholders may not touch the host; the pdf.js dependency decision, its click guard and second-load rule, and the `worker-src blob:` argument; Back places decided from each entry's own state; R12 re-classed; draft review and appearance rows added; and the minors.

### Commands

- `grep`, `sed` and a counting script over the standalone reader's source and the projects' section directories (counts only, no names).
- `gh issue view 1418 --json` (read only).
- No test was run: this wave is documents only.

### Asks and rulings

| Ask | Question | Answer |
|---|---|---|
| 596 | C1, old-origin state | The operator decides; the spec carries a fresh start as the recommendation and prices the import |
| 597 | C2, figures in print | Design drawn figures, staged, PNG only, capped and re-encoded by the console |
| 598 | C3, HTML pages beyond the walls | The operator decides; design the in-walls loader, count what stays standalone-only, price the widening |
| 599 | C4, ceilings | 64 MiB and 4 MiB, the coordinator's design default |
| 601 | Amend rich-docs §3.3 and §4.4 now? | No; the implementing wave amends them (Tasks P5.1 and P5.3) |

### Census note for P4.3

A new `coord.db` migration and a new docs constant can red tests outside the obvious set (migration counts, census suites, duration literals). P4.3 runs the server's migration and census suites in full before its push.

### The repo's review judge

At `bde0449dc`, every required check and CodeQL passed. The repo's review judge, which is not a required check, was red on two blocking reasons:

- `promise-delta-missing`: the new spec had no `promise-delta` fence. Fixed by spec §11, in the template's "none - <reason>" form.
- `pr1-files-invalid`: a first PR may hold one spec and at most one plan. This PR also amends the rich-docs spec's §6 parity table, which the wave's brief requires in the same PR, so it stays and is reported to the coordinator.
