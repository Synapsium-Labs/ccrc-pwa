# Native Docs draft review (X3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build "Share for review" (#1420): a frozen, read-only draft snapshot behind a private capability link, with its lifecycle (R1-R3), then signed-in comments (R4), as the spec below designs it.

**Architecture:** The owner's browser builds the snapshot with Export's own `buildExport` and uploads it once. A new server module, `server/src/review/`, keeps it in a never-backed-up file store and serves it only to a holder of a 256-bit token, which travels in the URL fragment and is posted, after a tap, from a fixed review page to one exempt read door. Owner and comment doors are session-gated. A sweep applies idle expiry, retention and early removal on commit through the existing docs tree read, handed to the module as a port.

**Tech Stack:** TypeScript; Fastify (server); React 19, Vite and vite-plugin-pwa (PWA); `node:fs` and `node:crypto`; vitest, and the browser leg under `pwa/browser/*.browser.test.ts`.

**Spec:** `docs/superpowers/specs/2026-11-18-native-docs-draft-review-design.md`. Read it first: its §1 threat model is the source of every guard below.

## Global Constraints

- Design wave X3 builds nothing. Every task below belongs to a later implementation run; this file is that run's plan.
- The two product choices are the operator's, answered on 2026-11-18 after the coordinator released this wave's asks: a capability link with no session to read; comments from signed-in sessions only, never merge approval. Comments are wave R4, a follow-on (the coordinator's direction): nothing in R1-R3 names, needs or anticipates them, and R4 adds its fields additively.
- Reader sandbox exactly `allow-scripts`, shell CSP exactly `frame-src 'none'`, no parent-DOM access, no extra message channel: none changes. The review page is a separate document with its own header policy.
- Both 2026-11-06 phone blocks stay byte for byte; the tap, one-bar and desktop-fit budgets stand. Share for review adds no head or bar control: one action row and the share rows in Page details, outside both phone blocks, and a list in the Docs index. Share itself is unchanged (coordinator's ruling on F14).
- `@synapsium-labs/docserver` stays exactly 1.1.0. No library change is needed.
- Limits, defined once in L0 `shared/docsReview.ts` (the export cap moves to `shared/docs.ts` and `pwa/src/docs/export/policy.ts` re-exports it): `DOCS_EXPORT_MAX_BYTES = 10485760`; `REVIEW_MAX_LIVE = 64`; `REVIEW_MAX_STORE_BYTES = 268435456`; `REVIEW_IDLE_MS = 604800000`; `REVIEW_RETENTION_MS = 2592000000`; `REVIEW_TOMBSTONE_MS = 604800000`; `REVIEW_VIEW_COARSEN_MS = 60000`; `REVIEW_SWEEP_MS = 600000`; `REVIEW_OPEN_STREAMS_PER_SHARE = 2`; `REVIEW_OPEN_STREAMS = 16`; `REVIEW_SEND_DEADLINE_MS = 60000`; `REVIEW_OPEN_BODY_BYTES = 256`; token 32 random bytes, base64url, 43 characters (`REVIEW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/`).
- The store is `~/.ccrc/review-shares/` (0700, files 0600), one writer (`server/src/review/store.ts`), never in `ccrc backup` or the update snapshot, never restored.
- Rings: `shared/docsReview.ts` L0 (imports only `shared/` siblings); `server/src/review/policy.ts` L1 (pure: no `fs`, no fastify, no clock read); `server/src/review/ports.ts` L2 (the tree-read port, declared by this consumer); `server/src/review/store.ts` L3; `server/src/review/routes.ts` and `sweep.ts` L4; composition in `server/src/server.ts#buildServer`, beside `composeDocs`.
- Every test and typecheck runs through `ccrc test -- <command>`, foreground, tool timeout at least 600000 ms. Fixture HOMEs only. Mutation scratch outside the worktree; restore from a saved copy, never `git checkout`.
- Release order (coordinator's ruling on F13): no release hands out a `/review#…` link before the page that opens it exists. R1 ships the read side and can make no link; R2 ships the page; R3, the owner's create, comes last. Every spec amendment lands with the wave that ships its behaviour: D-8765 with R1, D-8767 with R2, D-8766 with R3.
- Public repository: private-name scan of every changed file before each commit and before the push. Push once per round (D-8397).

## Review Focus

| Input or condition | Expected behaviour | Owning test |
|---|---|---|
| The owner revokes while a reviewer's read is in flight, and the read then records its view | The read completes with the old bytes or 404s; the late view writes nothing back; the next boot holds no entry | R1.3 `revoke during an open read` |
| Two tabs re-share the same file at once | One version per accepted call, bytes and index agree | R1.3 `concurrent re-share` |
| The server stops between renaming new bytes and renaming the index | The old version stays live; boot removes the unreferenced bytes | R1.3 `crash before the index rename` |
| The served ref is origin's branch while the local branch differs | The sweep reads the recorded served ref and removes nothing | R1.4 `served ref, not the local branch` |
| A reviewer opens the link on a device with the PWA installed | The review page loads from the network with its headers, never the shell or a cached copy | R2.3 `installed PWA does not answer /review` |

---

## Waves and file ownership

Docs workers stay serial (ledger), so the waves run one after another, each one run and one PR.

| Wave | Tasks | Owns (create or modify) | Depends on |
|---|---|---|---|
| R1 server, read side | R1.1-R1.5 | `shared/docsReview.ts`; `shared/docs.ts` (the export cap); `pwa/src/docs/export/policy.ts` (re-export, one line); `server/src/review/**`; `server/src/server.ts` (composition only); `server/src/config.ts` (one path); `server/src/auth/gate.ts` (class 9); `server/test/auth-gate.test.ts`, `box-token-census.test.ts`, the rings data files the rings suites ask for (`server/test/rings/*.data.ts`); new `server/test/review-*.test.ts`; `README.md` (auth paragraph); the base spec (D-8765) | none |
| R2 review page | R2.1-R2.3 | new `pwa/review.html`, `pwa/src/review/**`; `pwa/vite.config.ts` (second entry, `globIgnores`); `pwa/src/lib/sw-denylist.ts`; `server/src/review/routes.ts` (the page routes); `pwa/browser/app.ts` (a server mode and a service-worker context); new `pwa/browser/docs-review.browser.test.ts`; `pwa/test/docs-scans.test.ts` (the `DOMParser` allowance); the base and rich-docs specs (D-8767) | R1 merged |
| R3 owner side | R3.1-R3.4 | `server/src/review/routes.ts` (owner doors); `pwa/src/docs/export/buildExport.tsx`, `provenance.ts` (`purpose`); new `pwa/src/docs/review/**`; `pwa/src/lib/api.ts` (four calls); the Page details host and the Docs index screen (one mount each); `pwa/test/docs-scans.test.ts` (M4.EX16); `design/audit.mjs` (new chrome); new `pwa/test/docs-review-*.test.ts(x)`; the base spec (D-8766), rich-docs §6 pointers, README Docs section | R2 merged |
| R4 comments (follow-on) | R4.1-R4.2 | `shared/docsReview.ts` (additive fields and limits); `server/src/review/policy.ts`, `store.ts`, `routes.ts`; the census and gate tests; `pwa/src/lib/api.ts` (two calls); `pwa/src/docs/review/ReviewList.tsx`, `ReviewRows.tsx`; `pwa/src/review/main.ts`; new `server/test/review-comments.test.ts`, `pwa/test/docs-review-comments.test.tsx` | R3 merged |

Each wave's spec files are claimed at its run-open; the appearance and parity waves (X1, X2) edit the same specs, so a claim that answers 409 waits for its holder.

---

## Wave R1 — server, read side

### Task R1.1: L0 vocabulary and limits

**Files:**
- Create: `shared/docsReview.ts`
- Modify: `shared/docs.ts` (gains `DOCS_EXPORT_MAX_BYTES`), `pwa/src/docs/export/policy.ts` (re-exports it, no second literal)
- Test: `server/test/review-shared.test.ts`

**Interfaces:**
- Produces:
  - the constants in Global Constraints;
  - `type ReviewRemoval = 'revoked' | 'expired' | 'committed' | 'retention' | 'lost'` and `REVIEW_REMOVALS`, derived from a record keyed by it (`lost`: boot found an index entry whose bytes file is missing);
  - `type ReviewCreateRefusal = 'too-large' | 'store-full' | 'store-unreadable' | 'bad-source'` (`auth-off` is the account gate's word, never this type's);
  - `interface ReviewSource { project: string; section: DocSectionSlug; path: string; branch: string; head: string; servedRef: string; baseCommit: string; fp: string; committedBlob: string | null }`;
  - `interface ReviewShareWire { id: string; source: ReviewSource; version: number; sharedAt: number; firstSharedAt: number; idleSince: number; lastViewedAt: number | null; pinned: boolean; sha256: string; size: number; credentialShapes: number; link: string | null; removed: { why: ReviewRemoval; at: number } | null }`;
  - `isReviewToken(s: string): boolean`, `isReviewSource(x: unknown): x is ReviewSource` (project and path by the docs grammars `isDocsRelPath` and the project predicate, section in `DOC_SECTION_SLUGS`, `branch` and `servedRef` by the docs ref grammar, `head`, `baseCommit` and `committedBlob` 40-hex, `fp` 64-hex).

- [ ] **Step 1: Write the failing test** `review-shared.test.ts`: each constant equals its Global Constraints value; `isReviewToken` accepts a 43-character base64url string and refuses 42, 44, `+`, `/`, `=` and `''`; `REVIEW_REMOVALS` equals `['revoked','expired','committed','retention','lost']`; `isReviewSource` refuses a section `programs`, a path with `..`, a 39-hex head and a 63-hex `fp`.
- [ ] **Step 2: Run** `cd server && ccrc test -- ./node_modules/.bin/vitest run test/review-shared.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `shared/docsReview.ts` and the cap move.
- [ ] **Step 4: Run** it, `test/single-definition`, `test/rings`, then `cd ../pwa && ccrc test -- ./node_modules/.bin/vitest run test/docs-export.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): draft review vocabulary and limits (X3 R1.1)`.

### Task R1.2: L1 policy and L2 port

**Files:**
- Create: `server/src/review/policy.ts`, `server/src/review/ports.ts`
- Test: `server/test/review-policy.test.ts`

**Interfaces:**
- Consumes: R1.1.
- Produces:
  - `ports.ts`: `interface ReviewTreeReader { tree(project: string, servedRef: string): Promise<{ ok: true; tree: DocsTreeOk } | { ok: false } > }`, failure contract: any failure is `{ok:false}`, never a throw;
  - `type ReviewEntry` = `ReviewShareWire` without `link` and `removed`, plus `tokenHash: string`, `token: string` and `rev: number` (bumped by every write; `version` counts content only);
  - `expiryOf(e, now): { live: true } | { live: false; why: 'expired' | 'retention' }` — `retention` when `now - e.firstSharedAt >= REVIEW_RETENTION_MS`, pinned or not; else `expired` when `!e.pinned && now - e.idleSince >= REVIEW_IDLE_MS`;
  - `commitVerdict(e, tree: DocsTreeOk | null): 'keep' | 'committed' | 'unmeasured'` — `unmeasured` when `tree` is null, `tree.ref.served` differs from `e.source.servedRef`, or no entry has the share's section and path; `committed` when `(entry.committed?.blob ?? null) !== e.source.committedBlob`; else `keep`;
  - `viewDue(e, now): boolean` — `e.lastViewedAt === null || now - e.lastViewedAt >= REVIEW_VIEW_COARSEN_MS`;
  - `admitCreate({ size, live, storeBytes, replacing }): { ok: true } | { ok: false; why: 'too-large' | 'store-full' }` — order `too-large`, `store-full` (live count without the replaced share, bytes net of it). `auth-off` is never decided here: the account gate is its one writer;
  - `projectList(entries, tombstones, { armed, signedIn, origin }): ReviewShareWire[]` — `link` is `${origin}/review#${token}` only when both flags hold, else `null`.

- [ ] **Step 1: Write the failing tests**, one `it` per row: `expired` at exactly `REVIEW_IDLE_MS` after `idleSince`, live 1 ms before; a pinned share with `idleSince` 60 days ago and `firstSharedAt` 10 days ago is live; pinned at 30 days old is `retention`; `commitVerdict` is `committed` for a changed blob and for `null` to a blob, `keep` for an equal blob, `unmeasured` for a null tree, for a tree served at another ref, and for a missing entry, and for a same-path entry in another section; `viewDue` false at 59 999 ms and true at 60 000 ms; `admitCreate` gives `too-large` before `store-full`, refuses the 65th live share, admits a re-share when the store is exactly full; `projectList` gives `link: null` dark and signed out, and `https://h.example/review#<43 chars>` when both hold.
- [ ] **Step 2: Run** `ccrc test -- ./node_modules/.bin/vitest run test/review-policy.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** it and `test/rings`. Expected: PASS (add the files' ring rows where a rings suite asks, red first).
- [ ] **Step 5: Commit** `feat(review): deciders and the tree port (X3 R1.2)`.

### Task R1.3: L3 the review store

**Files:**
- Create: `server/src/review/store.ts`
- Modify: `server/src/config.ts` (`reviewStoreDir`, `~/.ccrc/review-shares`, defined once)
- Test: `server/test/review-store.test.ts` (fixture HOME, `mkTmp`)

**Interfaces:**
- Consumes: R1.1, R1.2.
- Produces `openReviewStore(dir: string, io: ReviewFs = nodeReviewFs): Promise<{ ok: true; store: ReviewStore } | { ok: false; why: 'store-unreadable' }>`, and `interface ReviewStore`:
  - reads: `byToken(token): ReviewEntry | null` (SHA-256 then an in-memory map), `byId(id)`, `bySource(project, section, path, branch)`, `all()`, `tombstones()`, `bytesUsed()`, `readBytes(tokenHash, version): Promise<Uint8Array | null>` (tests and the sweep only), `openBytes(tokenHash, version): Promise<{ stream: Readable; size: number } | null>` (a read stream over a descriptor opened while the entry is live, so a later unlink lets an in-flight send finish with the old bytes);
  - writes, each through one in-process queue. Each re-reads the live entry inside the queue, then applies `expiryOf(entry, now)`: a dead entry is removed there, with its reason, and the write answers `{ ok: false; why: 'expired' }`. Each write but `put` names `tokenHash` and `expectRev` and answers `{ ok: false; why: 'stale' }` when the entry is gone or at another revision. `put(source, bytes, credentialShapes, now)` runs `admitCreate` inside the queue on the store's own counts: for a source with no live share, a new share (`id` 16 random bytes hex, token `crypto.randomBytes(32)`, version 1), also when the source's share has just been removed as expired, answering `{ ok: true; entry; replacedExpired: boolean }`; for a source with a live share, the same token, `version + 1`, `idleSince = now`. `markViewed(tokenHash, expectRev, now)`, `setPinned(tokenHash, expectRev, pinned, now)` (unpin sets `idleSince = now`), `remove(tokenHash, expectRev | 'any', why, now)` (out of memory first; then the tombstone, with the reason and no token, written by temporary name, `fsync` and rename; then the index unlinked and the directory `fsync`ed; then the bytes unlinked and the directory `fsync`ed), `purgeTombstones(now)`;
  - layout and commit point as spec §4: `<tokenHash>.v<N>.html`, then `<tokenHash>.json`, each by temporary name, `fsync`, rename; directory `fsync`; then the superseded `v<N-1>` unlinked and the directory `fsync`ed;
  - `ReviewFs` is the small set of file operations the store uses (`open`, `write`, `fsync`, `rename`, `unlink`, `readdir`, `readFile`, `stat`), so a test can record their order or fail one of them; `nodeReviewFs` is the real one.
- At open: create the directory 0700 if absent; remove temporary files older than 60 s and every bytes file no index entry names; read every index file once; finish any removal whose tombstone exists beside its index entry, keeping the tombstone's reason; remove with `lost` any index entry whose bytes file is missing.

- [ ] **Step 1: Write the failing tests:** `put` then `byToken` returns the entry and `readBytes` gives identical bytes (SHA-256 compared); files 0600, directory 0700; no file name contains the token; a second `put` keeps the token, sets version 2 and `idleSince`; **`concurrent re-share`**: two `put` calls started together end at version 3, the index naming `v3` and `v3`'s bytes matching the second call; **`revoke during an open read`**: `markViewed(h, rev, now)` queued after `remove(h, rev, …)` answers `stale`, and a store re-opened from the same directory holds no entry for `h`; **`crash before the index rename`**: with `v2` bytes on disk and the index still naming `v1`, `open` serves `v1` and deletes `v2`; **`expiry is terminal`**: on a share whose `idleSince` is 7 days old and not yet swept, `setPinned` answers `expired` and removes it, and `put` for its source answers `replacedExpired: true` with a new token and version 1 while the old token finds nothing; **`concurrent create at the cap`**: with 63 live shares, two `put` calls for new sources started together admit exactly one and refuse the other `store-full`; a temporary file 61 s old is gone after `open`, one 10 s old stays; a directory at mode 000 gives `store-unreadable`; **Purge and durability (F6)**: after a re-share only `v2`'s bytes file exists; a recording `ReviewFs` sees `remove` write and `fsync` the tombstone, then unlink the index, then `fsync` the directory, then unlink the bytes, then `fsync` the directory, in that order; a `ReviewFs` failing the index unlink after the tombstone is written leaves a state that the next `open` finishes, with the tombstone's reason kept; an index entry whose bytes file is missing is removed `lost` at `open`, and its link finds nothing; the tombstone holds no 43-character token.
- [ ] **Step 2: Run** `ccrc test -- ./node_modules/.bin/vitest run test/review-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `store.ts`.
- [ ] **Step 4: Run** it, `test/single-definition` and `test/rings`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): the store, one writer, never backed up (X3 R1.3)`.

### Task R1.4: L4 the sweep

**Files:**
- Create: `server/src/review/sweep.ts`
- Modify: `server/src/server.ts` (start the sweep with an adapter over `docs.readers`' tree read at the given ref, through the docs lanes; stop it on close)
- Test: `server/test/review-sweep.test.ts`

**Interfaces:**
- Consumes: R1.2 (`ReviewTreeReader`, `expiryOf`, `commitVerdict`), R1.3.
- Produces `startReviewSweep(store: ReviewStore, reader: ReviewTreeReader, now: () => number): { stop(): void; runOnce(): Promise<void> }`. One pass: `expiryOf` on every entry; then group the live ones by project and `source.servedRef`, one `reader.tree` per group, `commitVerdict` per entry; `remove(e.tokenHash, e.rev, why, now)` for each removal, with the revision the verdict read; `purgeTombstones`. Runs at start and every `REVIEW_SWEEP_MS`; the timer handle is a field, so this file is L4.

- [ ] **Step 1: Write the failing tests:** three shares at one served ref cost one `tree` call; a changed blob removes with `committed`; `{ok:false}` removes nothing, nor does a tree without the path; **`served ref, not the local branch`**: a share recorded at `refs/remotes/origin/b` is read at that ref, and a reader that answers a different blob for `refs/heads/b` is never asked; a share 30 days old is removed `retention` with no `tree` call; a re-share or a pin between the verdict and the `remove` survives (the `remove` names the revision the verdict read, and answers `stale`); `stop` clears the timer (fake timers, no call after 2 × `REVIEW_SWEEP_MS`).
- [ ] **Step 2: Run** `ccrc test -- ./node_modules/.bin/vitest run test/review-sweep.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `startReviewSweep` and its wiring in `buildServer`.
- [ ] **Step 4: Run** it and `test/rings`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): the sweep (X3 R1.4)`.

### Task R1.5: L4 the read door, the gate, the census and the first amendments

**Files:**
- Create: `server/src/review/routes.ts`
- Modify: `server/src/server.ts` (the read door's own plugin: its own `bodyLimit` of `REVIEW_OPEN_BODY_BYTES`, its own `setErrorHandler` answering the one 404 for every body, parse, content-type and limit failure, and the marker check first; the page routes are R2.2's, the owner doors R3.1's); `server/src/auth/gate.ts` (`EXEMPT` gains `POST /api/review/open`, class 9 "draft review by capability: the token in the body is the credential; the door reads no session", and the header's class count); `server/test/auth-gate.test.ts` (nine classes); `server/test/box-token-census.test.ts` (`REVIEW_SRC`, hand-kept `REVIEW_DOORS`, both directions, a planted token call seen, the never-read scan); `README.md` (auth paragraph: class 9); the base spec (D-8765's sentences, below), claimed at R1's run-open
- Test: `server/test/review-routes.test.ts`, `server/test/review-backup.test.ts`

**Interfaces:**
- Consumes: R1.1-R1.4.
- Produces the read door of spec §5 (no route of R1 can create a share, so an R1 release hands out no link; tests seed the store through its own interface):
  - `REVIEW_MARKER_HEADER = 'x-ccrc-review'` with value `'1'` (L0, `shared/docsReview.ts`, which R2's page imports), checked before any token lookup;
  - `POST /api/review/open` body `{ token }`, `bodyLimit` `REVIEW_OPEN_BODY_BYTES` — 200 `application/octet-stream`, `Content-Disposition: attachment`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `x-ccrc-review-shared-at`, `x-ccrc-review-version`, `x-ccrc-review-idle-days`; otherwise 404 `{"ok":false,"error":"not-found"}` with the same four headers; 429 `busy` past `REVIEW_OPEN_STREAMS_PER_SHARE` sends of one share or `REVIEW_OPEN_STREAMS` in all; the bytes are piped from `openBytes`, the slot is released on the reply's `close` event (finish or abort), and a send still running `REVIEW_SEND_DEADLINE_MS` after it started is destroyed; no rate-limit config.

- [ ] **Step 1: Write the failing route tests** (`buildServer` on a fixture HOME, armed and dark, the store seeded through `put`): open with the token is 200, byte-identical to the seeded bytes, with each header; **M-X3.1**: unknown, 42-character, revoked and expired tokens, a request without the marker header, a 257-byte body, malformed JSON and a `text/plain` body all give byte-identical 404s (status, headers less `date`, body), and the marker-less, oversize and malformed ones make zero store lookups (a store whose `byToken` counts calls); these cases run on the real `buildServer`, armed with no cookie and dark; open sets `lastViewedAt` and a second open 30 s later does not rewrite it; `remove` through the store then open is 404 with no tick between; open behaves the same with a cookie and with the box token; open makes zero `runCcd` calls (a `runCcd` that throws). **Busy rows**: with two sends of share A held open, a third open of A is 429 `busy` while an open of share B is 200; aborting one held send lets the next open of A through (the slot is released on close); a reader that stops reading is destroyed at `REVIEW_SEND_DEADLINE_MS` (fake timers) and its slot released; with 16 sends held across eight shares, a ninth share's open is 429. **Revoke during a send**: a send of version 1 started before `remove` completes with version 1's bytes exactly, and the next open is the one 404.
- [ ] **Step 2: Write the census and gate tests**: `REVIEW_DOORS` equals the one registration; none consults the box token; only the open door is `EXEMPT`, with "reason 9"; the never-read scan finds none of `req.cookies`, `checkMailToken`, `requireMailToken`, `runCcd`, `ReviewTreeReader` or `docs.readers` in the open door's handler, with a planted control for each; `auth-gate.test.ts`'s class list has nine entries and `gate.ts`'s number words read nine.
- [ ] **Step 3: Write M-X3.7**, `review-backup.test.ts`: it reads `ccd/ccrc#_upd_backup_set`, `#cmd_backup` and `deploy/deploy.sh`'s backup lines, and fails if any copied path is `~/.ccrc/review-shares`, `~/.ccrc` itself or `$HOME`, with planted controls for each.
- [ ] **Step 4: Run** `ccrc test -- ./node_modules/.bin/vitest run test/review-routes.test.ts test/review-backup.test.ts test/auth-gate.test.ts test/box-token-census.test.ts`. Expected: FAIL on each new case.
- [ ] **Step 5: Implement** `registerReviewOpenRoute(app, deps)` in `routes.ts`; register its plugin after the docs plugin in `buildServer`; add the `EXEMPT` row and the README sentence; write D-8765's amendments into the base spec, each marked "(amended <date>; draft review, X3, D-8765)".
- [ ] **Step 6: Run** those four files and `test/single-definition`, `test/rings`, `test/citations.test.ts`, `test/anchors.test.ts`, `test/docs-parity.test.ts`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(review): the read door, gate class 9, census and D-8765 (X3 R1.5)`.

---

## Wave R2 — the review page

### Task R2.1: The page

**Files:**
- Create: `pwa/review.html`, `pwa/src/review/main.ts`, `pwa/src/review/review.css` (no React; imports only `shared/docsReview.ts`)
- Modify: `pwa/vite.config.ts` (`build.rollupOptions.input` gains `review`; workbox `globIgnores` gains `review.html`); the base spec's M5.16 and the rich-docs spec's A2b and M8.10 (D-8767's sentences), claimed at R2's run-open; `pwa/test/docs-scans.test.ts` (`new DOMParser(` allowed in `pwa/src/review/main.ts` beside `parse.ts`, with a planted control)
- Test: `pwa/test/review-page.test.ts` (jsdom)

- [ ] **Step 1: Write the failing tests** (**M-X3.10**): after load, `location.hash` is empty and no request has been made; the only control is "Open draft", and the POST to `/api/review/open` happens only on its click, with the token in the JSON body and the header `REVIEW_MARKER_HEADER: 1` imported from `shared/docsReview.ts`; on 200 the frame's `sandbox` attribute is the empty string and its `srcdoc` equals the response text; the banner reads "Draft, not committed. Shared for review on {date}. Read-only."; "Links in this copy" lists each `https:` href of the bytes once, as `<a rel="noreferrer noopener" target="_blank">`, and no `javascript:` or `data:` href; a 404 shows exactly "This link has expired, was revoked, or never existed." and no frame; a load with no hash shows exactly "To open this draft again, use the link you were sent." and makes no request; after an open, `sessionStorage`, `localStorage` and `document.cookie` hold nothing the page wrote, and `history.state` holds no token.
- [ ] **Step 2: Run** `cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/review-page.test.ts test/docs-scans.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the page and its entry.
- [ ] **Step 4: Run** them, then `ccrc test -- npm run build` and a check that the built service worker's precache list has no `review.html` (a case in `test/browser-dist.test.ts`). Expected: PASS.
- [ ] **Step 5: Write** D-8767's amendments into both specs, each marked "(amended <date>; draft review, X3, D-8767)", and run `test/docs-scans.test.ts` again. Expected: PASS.
- [ ] **Step 6: Commit** `feat(docs): the review page and D-8767 (X3 R2.1)`.

### Task R2.2: The page routes and the service worker

**Files:**
- Modify: `server/src/review/routes.ts` (`GET /review` sends the built `review.html` with the spec §3.5 policy header, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`; `GET /review.html` always 404), `server/src/auth/gate.ts` (`GET /review` joins class 9), `server/test/auth-gate.test.ts`, `box-token-census.test.ts` (`REVIEW_DOORS` three: R1.5's door, the page and `/review.html`); `pwa/src/lib/sw-denylist.ts` (own list gains `/^\/review(\/|$)/`), `pwa/test/sw-denylist.test.ts`
- Test: `server/test/review-routes.test.ts`

- [ ] **Step 1: Write the failing tests:** the `GET /review` CSP header equals the spec string exactly, with no `'unsafe-inline'` in `script-src` and no `allow-` token; the route answers the same bytes with and without a cookie, armed and dark; `GET /review.html` is 404 dark and never 200 armed; **M-X3.12**: `swDenylist(undefined)` matches `/review` and `/review/` and not `/reviews`.
- [ ] **Step 2: Run** `cd server && ccrc test -- ./node_modules/.bin/vitest run test/review-routes.test.ts test/auth-gate.test.ts test/box-token-census.test.ts` and `cd ../pwa && ccrc test -- ./node_modules/.bin/vitest run test/sw-denylist.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two routes and the denylist entry.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): the review page routes (X3 R2.2)`.

### Task R2.3: The real browser

**Files:**
- Modify: `pwa/browser/app.ts` (a `reviewServer` mode answering `/review`, `/review.html` and `/api/review/*` with exactly R2.2's headers and R1.5's bodies, served from a store the test seeds, and an option for a context with `serviceWorkers: 'allow'`)
- Create: `pwa/browser/docs-review.browser.test.ts`

- [ ] **Step 1: Write the failing browser tests:** a snapshot holding `<script>` and an `onerror` image runs neither (a global the payload would set stays unset) and `document.cookie` cannot be read from inside the frame; a 10 MiB snapshot opens and its last element is in the frame's DOM; clicking a link inside the frame does not navigate the frame, and the listed link opens a new tab whose request carries no `Referer`; **`installed PWA does not answer /review`**: with the built service worker installed and controlling the page, a navigation to `/review` reaches the server (the mode records it) and the response carries the CSP header.
- [ ] **Step 2: Run** `cd pwa && ccrc test -- ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/docs-review.browser.test.ts`. Expected: FAIL before the harness mode exists, then on any guard removed.
- [ ] **Step 3: Implement** the harness mode and option.
- [ ] **Step 4: Run** it and the existing browser files that import `app.ts` (`browser/` whole, through `ccrc test`). Expected: PASS.
- [ ] **Step 5: Commit** `test(docs): the review page in a real browser (X3 R2.3)`.

---

## Wave R3 — owner side

R3 is the first release that can make a link, so it follows R2: the page and its door are already installed, and a service worker installed before R2 has had a release to update.

### Task R3.1: The owner doors

**Files:**
- Modify: `server/src/review/routes.ts` (`registerReviewOwnerRoutes`, whose create handler calls the account gate first with `{ cap: null }`), `server/src/server.ts` (a second plugin for the owner doors, without the docs provenance policy), `server/test/auth-gate.test.ts` (`FLAG_AWARE` gains the create door, as the account routes are listed), `server/test/box-token-census.test.ts` (`REVIEW_DOORS` seven: R1's open door, R2's two page routes, these four)
- Test: `server/test/review-routes.test.ts`

**Interfaces:**
- Consumes: R1.1-R1.5.
- Produces:
  - `POST /api/review/shares` — body `{ source: ReviewSource; bytes: string /* base64 */; credentialShapes: number }`, `bodyLimit` = `Math.ceil(DOCS_EXPORT_MAX_BYTES * 4 / 3) + 4096`; `{ ok: true; share: ReviewShareWire }` or `{ ok: false; why }` (the account gate's `auth-off` dark, 413 `too-large`, 409 `store-full`, 503 `store-unreadable`, 400 `bad-source`);
  - `GET /api/review/shares?project=&section=&path=` (each optional; all absent lists every share) — `{ ok: true; shares }`, 400 `bad-query`;
  - `POST /api/review/shares/:id/pin` body `{ pinned: boolean }`; `POST /api/review/shares/:id/revoke` — `{ ok: true; share }` or 404 `unknown-share`.

- [ ] **Step 1: Write the failing tests** (real `buildServer`): create dark answers exactly what the account gate answers for `auth-off` (its status and body, measured, not restated); create armed without a session is 401; create armed and signed in gives a share whose `link` is `https://<origin>/review#<43 chars>`, and opening it through R1's door gives the uploaded bytes; the list on a dark gate, over shares made armed, gives every `link` as `null`; a snapshot of `DOCS_EXPORT_MAX_BYTES + 1` bytes is 413; the 65th live share is 409; `REVIEW_DOORS` equals the seven registrations and none of the four is `EXEMPT`.
- [ ] **Step 2: Run** `cd server && ccrc test -- ./node_modules/.bin/vitest run test/review-routes.test.ts test/auth-gate.test.ts test/box-token-census.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four doors.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): the owner doors (X3 R3.1)`.



### Task R3.2: Export's builder gains `purpose`

**Files:**
- Modify: `pwa/src/docs/export/buildExport.tsx` (`ExportInput.purpose?: 'file' | 'review'`, default `'file'`), `provenance.ts` (the review banner lead), `policy.ts` (the `ccrc:purpose` meta name)
- Test: `pwa/test/docs-export.test.tsx`

- [ ] **Step 1: Write the failing tests:** with `purpose: 'review'` the file holds `<meta name="ccrc:purpose" content="review">` and its banner starts "Shared for review. Read-only."; with no `purpose` the bytes equal today's on one Markdown and one mockup fixture; `DOCS_EXPORT_CSP` is unchanged.
- [ ] **Step 2: Run** `cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/docs-export.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the optional field and the two text changes.
- [ ] **Step 4: Run** every `test/docs-export*` file and `test/mockup-export.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(docs): Export's builder takes a review purpose (X3 R3.2)`.

### Task R3.3: The review action in Page details

**Files:**
- Create: `pwa/src/docs/review/shareForReview.ts` (L1, pure), `pwa/src/docs/review/upload.ts`, `pwa/src/docs/review/ReviewConfirm.tsx`
- Modify: the Page details host (one mount of the action row), `pwa/src/lib/api.ts` (`reviewCreate`, `reviewList`, `reviewPin`, `reviewRevoke`), `pwa/test/docs-scans.test.ts` (M4.EX16: `ReviewConfirm.tsx` may `import()` `./export/buildExport`, and `upload.ts` may receive its bytes, each with a planted control; `new Blob(` stays in `objectUrls.ts` only)
- Test: `pwa/test/docs-review-share.test.tsx`

**Interfaces:**
- Consumes: R3.1's wire, R3.2, `shared/redact.mjs#redactCount`, `shared/api.ts#CREDENTIAL_MASKS`.
- Produces: `reviewOfferFor(tree, page, entry, opened, exportReady): { offered: true } | { offered: false; sentence: string }`; `credentialCount(exportText: string): number` (cuts every `data:image/…;base64,…` payload, then sums `redactCount('linear-egress', text, shapesOf(CREDENTIAL_MASKS)).masked`).
- Exact sentences: action "Share a draft for review"; confirm title "Share a private copy for review"; hold "This draft holds {n} strings that look like credentials." with "Go back" and "Share anyway"; done "Anyone with this link can read this copy until {date}." No Share sentence changes.

- [ ] **Step 1: Write the failing tests:** the action row shows in Page details only when the leaf opens a draft, a new file included, and never in the Share sheet; Share's own suites (`docs-share.test.ts`, `docs-share-sheet.test.tsx`) run unchanged and green, so `share-drafts`, M4.SH1 and M4.SH3 still hold; it is disabled with Export's sentence whenever Export is; the confirm lists every inlined file with size and draft mark, every omitted file and every link target from the `ExportResult`; a fake token of valid shape inside a mockup's inline script holds the share, and "Share anyway" uploads with `credentialShapes: 1`; a base64 image payload containing that shape does not count; **M-X3.14**: the upload is not called before the check settles; **M-X3.13**: the upload's bytes equal `buildExport`'s (SHA-256); after success the confirm offers Copy link through `copyText`, and M4.SH7 still finds one `clipboard.writeText(` under `pwa/src/docs`.
- [ ] **Step 2: Run** `ccrc test -- ./node_modules/.bin/vitest run test/docs-review-share.test.tsx test/docs-share.test.ts test/docs-share-sheet.test.tsx test/docs-scans.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the module, the upload and the action row.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat(docs): Share a draft for review (X3 R3.3)`.

### Task R3.4: The owner's controls and the newer-draft notice

**Files:**
- Create: `pwa/src/docs/review/ReviewRows.tsx`, `ReviewList.tsx`, `reviewWords.ts` (L1)
- Modify: the Page details host and the Docs index screen (one mount each); `design/audit.mjs` (`GROUNDS` for the new chrome)
- Test: `pwa/test/docs-review-owner.test.tsx`

- [ ] **Step 1: Write the failing tests:** a leaf with a live share whose `source.fp` differs from the page's `fp` shows "Shared for review on {date}. A newer draft is available." and Re-share, which opens the same `ReviewConfirm` as a first share (the file and link list, then the credential hold) and only after its confirm uploads and shows version 2; a re-share whose new draft holds a credential-shaped string is held until "Share anyway"; an equal `fp` shows no notice; Pin turns "Stops working {date}" into "Pinned"; Revoke asks once, then the row reads "Revoked"; Re-share of a file whose share expired shows "The old link has expired and stays dead. This is a new link." and the new link; Pin on an expired share shows "Expired: no view for 7 days" and no pinned state; each removal shows its exact sentence ("Revoked", "Expired: no view for 7 days", "Removed: committed on {branch}", "Removed: 30-day limit", "Removed: its copy could not be read"); the index list shows live and removed shares, and no Copy link when `link` is null.
- [ ] **Step 2: Run** `ccrc test -- ./node_modules/.bin/vitest run test/docs-review-owner.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the rows, the list and the words.
- [ ] **Step 4: Run** it, `test/contrast.test.ts` and the design audit. Expected: PASS.
- [ ] **Step 5: Write** D-8766's amendments into the base spec and point rich-docs §6 rows G11 and "Draft review by link" at this feature's spec; update the README Docs section. Run `cd server && ccrc test -- ./node_modules/.bin/vitest run test/docs-parity.test.ts test/citations.test.ts test/anchors.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(docs): owner controls for shared drafts and D-8766 (X3 R3.4)`.

---

## Wave R4 — signed-in comments (follow-on)

The operator adopted comments from signed-in readers only; spec §3.6 and its threats C1-C5 govern. Every field is additive: an R1-R3 build that reads an index entry with `comments` ignores it, and R4 reads an entry without it as no notes.

### Task R4.1: Server: the comment vocabulary, store and doors

**Files:**
- Modify: `shared/docsReview.ts` (`REVIEW_MAX_COMMENTS = 100`, `REVIEW_COMMENT_MAX_CHARS = 2000`, `interface ReviewComment { at: number; version: number; text: string }`, `ReviewShareWire.comments?: readonly ReviewComment[]`); `server/src/review/policy.ts` (`admitComment`); `server/src/review/store.ts` (`addComment`, through the same queue and version re-read; a tombstone keeps only the count); `server/src/review/routes.ts` (two doors); `server/test/auth-gate.test.ts` (`FLAG_AWARE` gains the comment door); `server/test/box-token-census.test.ts` (`REVIEW_DOORS` nine (R3's seven and these two); a scan that no `server/src/review/**` file imports a forge or pull-request module, with a planted control)
- Test: `server/test/review-comments.test.ts`

**Interfaces:**
- Produces:
  - `admitComment(e, text): { ok: true; text: string } | { ok: false; why: 'too-long' | 'too-many' }` — removes control characters other than `\n`, then measures; both comment doors call the account gate first, the one writer of `auth-off`;
  - `POST /api/review/thread` body `{ token }` — `{ ok: true; comments }`, 403 `auth-off`, the read door's one 404;
  - `POST /api/review/comment` body `{ token, text }` — `{ ok: true; comments }`, 403 `auth-off`, 400 `too-long`, 409 `too-many`, the one 404.

- [ ] **Step 1: Write the failing tests:** `admitComment` refuses 2001 characters after stripping and the 101st note; comment and thread answer the account gate's `auth-off` dark and 401 armed without a session; armed and signed in, a note appends with the share's current version and the thread returns it byte for byte as plain text; a re-share keeps the notes; revoke deletes them and the tombstone keeps only the count; the forge-import scan is green, and red on a planted import.
- [ ] **Step 2: Run** `cd server && ccrc test -- ./node_modules/.bin/vitest run test/review-comments.test.ts test/auth-gate.test.ts test/box-token-census.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the fields, the decider, the store write and the two doors.
- [ ] **Step 4: Run** them and `test/single-definition`, `test/rings`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): signed-in comments, server half (X3 R4.1)`.

### Task R4.2: PWA: notes on the review page and in the owner's list

**Files:**
- Modify: `pwa/src/lib/api.ts` (`reviewThread`, `reviewComment`), `pwa/src/review/main.ts`, `pwa/src/docs/review/ReviewList.tsx`, `ReviewRows.tsx` (the count)
- Test: `pwa/test/docs-review-comments.test.tsx`, `pwa/test/review-page.test.ts`

- [ ] **Step 1: Write the failing tests:** on the review page, a thread answering 401 or 403 shows no notes and no text box, and 200 shows "Notes from reviewers. Not a pull request review.", the notes and a text box; the owner's list shows each share's notes under that heading; a note holding `**x**` and `<b>` renders those characters literally in both places; Page details shows the count.
- [ ] **Step 2: Run** `cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/docs-review-comments.test.tsx test/review-page.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two calls and the three views, notes as text nodes only.
- [ ] **Step 4: Run** them and `test/contrast.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(docs): signed-in comments, PWA half (X3 R4.2)`.

---

## Mutation rows

Each row is measured red and then restored from a saved copy, with the failing count recorded in the run's Results. M-X3.1 to M-X3.15 are the spec's §7 rows; the rest guard this plan's interfaces.

| Id | File | Mutation | Must red |
|---|---|---|---|
| NDR-X3-R1-M1 | `shared/docsReview.ts` | `REVIEW_MAX_LIVE = 65` | `review-shared` (M-X3.9) |
| NDR-X3-R1-M2 | `review/policy.ts` | `expiryOf` reads `sharedAt`, not `idleSince` | `review-policy` (M-X3.4) |
| NDR-X3-R1-M3 | `review/policy.ts` | pinned skips retention | `review-policy` pinned 30-day row (M-X3.4) |
| NDR-X3-R1-M4 | `review/policy.ts` | `commitVerdict` compares `fp` | `review-policy` blob rows (M-X3.5) |
| NDR-X3-R1-M5 | `review/policy.ts` | another served ref is not `unmeasured` | `review-policy`, `review-sweep` served-ref row (M-X3.5) |
| NDR-X3-R1-M6 | `review/policy.ts` | `unmeasured` answers `committed` | `review-policy`, `review-sweep` (M-X3.5) |
| NDR-X3-R3-M101 | `review/policy.ts` | `projectList` ignores `armed` | `review-policy`, `review-routes` dark list (M-X3.8) |
| NDR-X3-R3-M102 | `review/routes.ts` | the create handler skips the account gate | `review-routes` dark create (M-X3.8) |
| NDR-X3-R1-M103 | `review/routes.ts` | the marker check moved after the token lookup | `review-routes` marker-less lookup count (M-X3.1) |
| NDR-X3-R1-M104 | `review/routes.ts` | the plugin's error handler removed, so the server's default answers a bad body | `review-routes` oversize and malformed rows (M-X3.1) |
| NDR-X3-R1-M11 | `review/store.ts` | `markViewed` skips the version re-read | `review-store` revoke-during-read (M-X3.2) |
| NDR-X3-R1-M12 | `review/store.ts` | `remove` deletes from memory last | `review-routes` revoke-then-open (M-X3.2) |
| NDR-X3-R1-M13 | `review/store.ts` | the index written before the bytes | `review-store` crash row |
| NDR-X3-R1-M14 | `review/store.ts` | boot keeps unreferenced bytes | `review-store` crash row |
| NDR-X3-R1-M15 | `review/store.ts` | the token written into the tombstone | `review-store` |
| NDR-X3-R1-M114 | `review/store.ts` | `put` leaves the superseded version on disk | `review-store` purge row (F6) |
| NDR-X3-R1-M115 | `review/store.ts` | `remove` unlinks the bytes before the index | `review-store` order row (F6) |
| NDR-X3-R1-M116 | `review/store.ts` | no directory `fsync` after the index unlink | `review-store` order row (F6) |
| NDR-X3-R1-M117 | `review/store.ts` | the tombstone written after the index unlink | `review-store` order and interrupted-removal rows (F6) |
| NDR-X3-R1-M118 | `review/store.ts` | boot keeps an index entry whose bytes file is missing | `review-store` lost row (F6) |
| NDR-X3-R1-M105 | `review/store.ts` | `put` keeps the token of an expired, unswept share | `review-store` expiry-is-terminal row (F3) |
| NDR-X3-R1-M106 | `review/store.ts` | `setPinned` skips `expiryOf` | `review-store` expiry-is-terminal row (F3) |
| NDR-X3-R1-M107 | `review/store.ts` | `admitCreate` run before the queue | `review-store` concurrent-create row (F3) |
| NDR-X3-R1-M108 | `review/store.ts` | `setPinned` does not bump `rev` | `review-sweep` pin-race row (F3) |
| NDR-X3-R1-M16 | `review/sweep.ts` | one `tree` call per share, not per ref | `review-sweep` |
| NDR-X3-R1-M17 | `review/sweep.ts` | reads `refs/heads/<branch>` | `review-sweep` served-ref row (M-X3.5) |
| NDR-X3-R1-M18 | `review/routes.ts` | open skips `expiryOf` | `review-routes` expired 404 (M-X3.3) |
| NDR-X3-R1-M19 | `review/routes.ts` | revoked answers 410 | `review-routes` identical 404 (M-X3.1) |
| NDR-X3-R1-M20 | `review/routes.ts` | drop each of the four headers, one row each | `review-routes` (M-X3.11) |
| NDR-X3-R1-M21 | `review/routes.ts` | the open handler calls the tree reader | `box-token-census` never-read scan (M-X3.6) |
| NDR-X3-R1-M22 | `review/routes.ts` | the per-share limit removed | `review-routes` busy rows (F5) |
| NDR-X3-R1-M111 | `review/routes.ts` | the slot released on `finish` only, not on `close` | `review-routes` abort row (F5) |
| NDR-X3-R1-M112 | `review/routes.ts` | the send deadline removed | `review-routes` stalled-reader row (F5) |
| NDR-X3-R1-M113 | `review/routes.ts` | the bytes sent as one buffer from `readBytes` | `review-routes` revoke-during-send row: the in-flight send's bytes stay the old version (F5) |
| NDR-X3-R1-M23 | `auth/gate.ts` | the create door added to `EXEMPT` | `auth-gate`, `box-token-census` |
| NDR-X3-R1-M24 | `ccd/ccrc` | the backup set copies `~/.ccrc` whole | `review-backup` (M-X3.7) |
| NDR-X3-R3-M1 | `review/shareForReview.ts` | offered on a committed leaf | `docs-review-share` |
| NDR-X3-R3-M2 | `review/ReviewConfirm.tsx` | upload before the credential check | `docs-review-share` (M-X3.14) |
| NDR-X3-R3-M3 | `review/shareForReview.ts` | scan the source text only | `docs-review-share` inline-script row (M-X3.14) |
| NDR-X3-R3-M4 | `review/upload.ts` | re-render the body instead of sending `buildExport`'s bytes | `docs-review-share` SHA row (M-X3.13) |
| NDR-X3-R3-M5 | `review/ReviewRows.tsx` | notice on an equal `fp` | `docs-review-owner` |
| NDR-X3-R3-M109 | `review/ReviewRows.tsx` | Re-share uploads without opening `ReviewConfirm` | `docs-review-owner` re-share hold row (F2) |
| NDR-X3-R2-M1 | `src/review/main.ts` | keep the hash | `review-page` (M-X3.10) |
| NDR-X3-R2-M2 | `src/review/main.ts` | post the token on load | `review-page` (M-X3.10) |
| NDR-X3-R2-M110 | `src/review/main.ts` | keep the token in `sessionStorage` for a reload | `review-page` storage row (F4) |
| NDR-X3-R2-M3 | `src/review/main.ts` | `sandbox="allow-scripts"` | `review-page`, browser script row (M-X3.10) |
| NDR-X3-R2-M4 | `review/routes.ts` | `script-src 'self' 'unsafe-inline'` | `review-routes` page CSP row (M-X3.10) |
| NDR-X3-R2-M5 | `vite.config.ts` | drop `review.html` from `globIgnores` | `browser-dist` precache row, browser installed-PWA row (M-X3.12) |
| NDR-X3-R2-M6 | `sw-denylist.ts` | drop the `/review` entry | `sw-denylist` (M-X3.12) |
| NDR-X3-R2-M7 | `review/routes.ts` | `GET /review.html` serves the file | `review-routes` (M-X3.12) |
| NDR-X3-R4-M1 | `review/routes.ts` | the comment handler skips the account gate | `review-comments` dark rows (M-X3.8, C1) |
| NDR-X3-R4-M2 | `review/policy.ts` | caps raised to 200 notes or 4000 characters | `review-comments` (M-X3.9, C3) |
| NDR-X3-R4-M3 | `review/policy.ts` | control characters kept | `review-comments` |
| NDR-X3-R4-M4 | `review/ReviewList.tsx` | a note rendered through the Markdown component | `docs-review-comments` literal row (M-X3.15, C2) |
| NDR-X3-R4-M5 | `review/routes.ts` | the module imports the pull-request module | `box-token-census` forge-import scan (M-X3.15, C4) |


## Acceptance (Task 17, Draft review row)

The completion plan's Task 17 runs one row for this capability. Its clauses map one to one onto the rows below, each recorded with Task 17's evidence interface `{capability, releaseTag, commit, installedBuild, engineOrBox, action, observed, coverageLimit, timestamp, verdict}`, on the installed release. Rows that need a clock or a stopped agent run on the test box, never on the live boxes.

| Row | Task 17 clause | Installed action | Required observation |
|---|---|---|---|
| DR-1 | Share a frozen read-only snapshot | On a draft spec, Page details, Share a draft for review, confirm; then open Share | A link `https://<origin>/review#<43 chars>` from the action, while Share still offers only the committed permalink; the owner's list shows the share live 
| DR-2 | the draft banner | Open the link with no ccrc session; tap Open draft | "Draft, not committed. Shared for review on <date>. Read-only." above the copy, and the copy's own banner |
| DR-3 | unchanged shared bytes after edits | Edit and save the draft; open the link again from the original message | The served bytes' SHA-256 equals the one recorded at share |
| DR-4 | newer-draft notice/re-share | Open the edited leaf as the owner; Re-share; open the link again from the original message | The notice shows; after Re-share the same link shows the edit at version 2 |
| DR-5 | last-view TTL | Test box: stop the server, set a share's `idleSince` 7 days back in its index file, start the server | The boot sweep removes it "Expired: no view for 7 days"; the link 404s |
| DR-6 | early removal on same-file branch commit | Commit and push the shared file on its branch; wait one sweep (at most 10 minutes) | "Removed: committed on <branch>"; the link 404s |
| DR-7 | UI Pin/Revoke | Pin, unpin, then revoke from Page details and from the index list | Each state shows in both places |
| DR-8 | retention | Test box: as DR-5, a pinned share with `firstSharedAt` 30 days back | Removed "Removed: 30-day limit" though pinned |
| DR-9 | immediate revoked 404 | Revoke, then at once open the link again from the original message; separately, reload an open review tab | The 404 sentence on the first open after Revoke; the reload shows "To open this draft again, use the link you were sent." |
| DR-10 | unreadability after expiry | After DR-5, DR-6 and DR-8, list the store directory (names only) | No bytes and no index file for those shares; tombstones only, with no token |
| DR-11 | access model vs no-session criterion | Open the link signed out, in a private window, on a phone and on a desktop | It opens with no sign-in (the ruled capability model); a guessed or malformed token gives the same 404 |
| DR-12 | never a live working-tree read | Test box: with the agent link down, open a live link | It opens: the read needs nothing from the fleet box. The release's never-read scan (M-X3.6) passes at the release commit |

---

## Deviations found

Three departures, defined by fix round 1 of run 2633 from this wave's issued block on the coordinator's ruling of review finding F14. Each carries out the operator's ruling of 2026-10-25 on #1420 (a frozen snapshot shared for review, required before retirement) and the operator's answers to this wave's asks 595 (a capability link, no session to read) and 603 (signed-in comments only). Each is written into its spec by the wave that ships its behaviour.

- **D-8765 (2026-11-19)** — draft-review-store-and-read-door. Departs from the base spec (`docs/superpowers/specs/2026-10-01-native-docs-reader-design.md`):
  - Goal 1: "**Each install reads its own projects' docs.** That means whatever ccd's projects root holds on that install's fleet box, behind that install's own session gate."
  - Goal 3: "Docs stay in the operator's repositories and reach only the operator's signed-in browser. The one way document bytes leave that browser is a file the operator explicitly saves with Export (amended 2026-10-13, §4.17). It is built in the browser from what the page already holds, ccrc stores nothing for it, and Share sends only a GitHub URL."
  - Decision `product`: "A session-gated Docs reader for each install's own project docs. It never bundles docs."
  - Non-goal: "**Share links that ccrc hosts** (amended 2026-10-13). Share sends a GitHub URL only. Expiring links served by ccrc, and Export of a section or directory as a bundle, are deferred (§4.13)."
  - §4.13: "**Expiring share links** (operator, 2026-10-06: later, as their own designed wave with a threat model). Nothing is designed for them."

  What changes: the owner may explicitly share a frozen snapshot, which the owner's own server keeps for a bounded time and serves to a capability holder through one exempt read door and its page, outside the session gate. Export of a section or directory as a bundle stays deferred, and Share still sends only a GitHub URL. Lands with R1.
- **D-8766 (2026-11-19)** — draft-review-export-confinement. Departs from the base spec:
  - §4.13: "**What keeps the option open.** Share's result is a discriminated union, so a link kind with an expiry can be added as one more arm. The export builder is pure, and its `ccrc-docs-export/1` generator meta versions the format. Share and Export spend no page key, route or census entry, and write no durable state."
  - M4.EX16: "`buildExport.tsx` exports only `buildExport` and types, and `buildExport` is imported only by `docs/ExportSheet.tsx`, which passes its result's bytes only to `downloadExport`;"

  What changes: the expiring link is its own action, not a Share arm; Export's builder gains a second importer (`docs/review/ReviewConfirm.tsx`, by `import()`) and its bytes a second consumer (`docs/review/upload.ts`), each with a planted control; the action spends routes and writes durable state, Share and Export still do neither. Not departed: §4.16's "It runs entirely in the PWA. It adds no route, wire field, page key or census entry, and writes no durable state." stays true, because Share is unchanged. Lands with R3.
- **D-8767 (2026-11-19)** — draft-review-page-frame-and-parser. Departs from base M5.16: "`<iframe` and `srcDoc` only in `MockupFrame.tsx` and, amended 2026-10-13, `docs/export/buildExport.tsx`" and "`new DOMParser(` only in `docs/mockup/parse.ts`"; and from the rich-docs spec (`docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md`) A2b: "`<iframe` and `srcDoc` only in `MockupFrame.tsx` and `docs/export/buildExport.tsx`, the mockup export's wrapper, and, outside `pwa/src/docs`, in `pwa/src/readerLab/frames.ts` only", which M8.10 pins "As A2b". What changes: `pwa/src/review/main.ts` gains one allowance for each, an `<iframe sandbox="">` with `srcdoc` and one inert `DOMParser` parse of the copy's bytes for its links list, each with its own planted control. The reader frame's sandbox and the shell's CSP are unchanged. Lands with R2.

## Results (design wave X3, run 2633)

**What was measured and read** (2026-11-18, `main` at `6f5421139`):
- Issue #1420 and its one comment (the operator's 2026-10-25 ruling); #1419 (forge review of a document, for the comments question); #276 (identity, for the access question).
- The ledger's Carried constraints, "Recorded draft decision" and "Retirement drops no feature" in full; the completion plan's Delivery units "Required follow-ons" row, Task 16 steps 1-2, Task 17 and its Required extension acceptance matrix; the completion design's draft rows; the rich-docs §6 rows G11 and "Draft review by link"; the base spec's §0, §4.13, §4.16, §4.17 and §5.6.9.
- Shipped source, by reading and four Sonnet·medium fact-check passes: Share and Export (`share.ts`, `buildExport.tsx`, `exportInput.ts`, `exportMarkdown.tsx`, `provenance.ts`, `policy.ts`); the docs routes and read path (`server/src/docs/*`, `shared/docs.ts`); the auth gate's `EXEMPT` table, its tests and the box-token census; `buildServer`'s static fallback; `vite.config.ts`'s precache and `sw-denylist.ts`; the browser harness `pwa/browser/app.ts`; the backup set in `ccd/ccrc`; `shared/redact.mjs` and `CREDENTIAL_MASKS`; the generated Caddyfile (host plus `reverse_proxy`, no access log).
- The standalone reader's source, for behaviour only: drafts served live, no access control, no snapshot, expiry, revocation or comments.
- One Opus·high adversarial read of the spec and plan: 16 findings (11 important, 5 minor, none critical), every one fixed in this revision. The main ones: the precached page would have been served without its headers; links inside the copy could never work, so they are inert and listed outside; the plan's files would have reddened the docs module's own guards, so the feature is its own module under `/api/review`; store writes acted on stale entries, so every mutation now re-reads by version; early removal read the wrong ref and keyed shares without their section; the idle clock never restarted; the credential check called the redactor wrongly and scanned too little; the fragment's protection was overstated, so the token is posted only after a tap and the residual is stated (T3a); the browser harness could not run the rows, so R3.3 adds a server mode; a shared rate limit let one caller lock every reviewer out, so it is dropped.

**Commands run:** `ccrc-api mail inbox`; `ccrc-api claims take` (claim 5299); `gh issue view 1420|1419|276 -R Synapsium-Labs/ccrc-pwa`; `grep` and `sed` reads of the files above; one `graphify query`. No test was run: the wave changes documents only.

**Asks:** two, ask 595 (access model) and ask 603 (comments). The coordinator released both to the operator (mails 25240 and 25405), and both came back answered on the structured ask on 2026-11-18. Access model: capability link (the recommendation). Reviewer comments: signed-in comments only (not the recommendation, which was none). Following the coordinator's direction for an adopted comment feature, comments are the follow-on wave R4 with their own threats (spec §3.6, C1-C5), and nothing in R1-R3 depends on them. The finished ask records are no longer listed, so who answered is read from the release mails, not measured.
