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
- Both 2026-11-06 phone blocks stay byte for byte (they are measurement records, so nothing here edits them); the tap, one-bar and desktop-fit budgets stand. Share for review adds no head or bar control: one action row and the share rows in Page details, and a list in the Docs index. Its checked condition is `pwa/test/control-census.test.ts`'s `docs/DocsHead.tsx` entries and `pwa/test/tap-targets.test.tsx`'s compact-head floor rows: a row that cannot be placed without changing an existing entry, floor row or budget is a stop-and-ask (N7). Share itself is unchanged (coordinator's ruling on F14).
- `@synapsium-labs/docserver` stays exactly 1.1.0. No library change is needed.
- Limits, defined once in L0 `shared/docsReview.ts` (the export cap moves to `shared/docs.ts` and `pwa/src/docs/export/policy.ts` re-exports it): `DOCS_EXPORT_MAX_BYTES = 10485760`; `REVIEW_MAX_LIVE = 64`; `REVIEW_MAX_STORE_BYTES = 268435456`; `REVIEW_IDLE_MS = 604800000`; `REVIEW_RETENTION_MS = 2592000000`; `REVIEW_TOMBSTONE_MS = 604800000`; `REVIEW_VIEW_COARSEN_MS = 60000`; `REVIEW_SWEEP_MS = 600000`; `REVIEW_PENDING_RETRY_MS = 10000`; `REVIEW_OPEN_STREAMS_PER_SHARE = 2`; `REVIEW_OPEN_STREAMS = 16`; `REVIEW_SEND_IDLE_MS = 30000`; `REVIEW_OPEN_BODY_BYTES = 256`; token 32 random bytes, base64url, 43 characters (`REVIEW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/`).
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
| R1 server, read side | R1.1-R1.5 | `shared/docsReview.ts`; `shared/docs.ts` (the export cap); `pwa/src/docs/export/policy.ts` (re-export, one line); `server/src/review/**`; `server/src/server.ts` (composition only); `server/src/config.ts` (one path); `server/src/auth/gate.ts` (class 9); `server/test/auth-gate.test.ts`, `box-token-census.test.ts`, the rings data files the rings suites ask for (`server/test/rings/*.data.ts`); the architecture spec's ring-context table (`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, C9 Docs row, server column); new `server/test/review-*.test.ts`; `README.md` (auth paragraph); the base spec (D-8765) | none |
| R2 review page | R2.1-R2.3 | new `pwa/review.html`, `pwa/src/review/**`; `server/src/pwaStatic.ts` (the `allowedPath` filter); `pwa/vite.config.ts` (second entry, `globIgnores`); `pwa/src/lib/sw-denylist.ts`; `server/src/review/routes.ts` (the page routes); `pwa/browser/app.ts` (a server mode and a service-worker context); new `pwa/browser/docs-review.browser.test.ts`; `pwa/test/docs-scans.test.ts` (the `DOMParser` allowance); `pwa/test/reader-lab-scans.test.ts` (the iframe allowances); `pwa/src/screens/ReaderLab.tsx` (one anchor to M-X3.16's measurement page, R2.3) and `pwa/test/control-census.test.ts`; the reader lab design (D-8767); the architecture spec's ring-context table (C9 Docs row, PWA column); the base and rich-docs specs (D-8767) | R1 merged |
| R3 owner side | R3.1-R3.4 | `server/src/review/routes.ts` (owner doors); `pwa/src/docs/export/buildExport.tsx`, `provenance.ts` (`purpose`); new `pwa/src/docs/review/**`; `pwa/src/lib/api.ts` (four calls); the two host files, `pwa/src/docs/DocsHead.tsx` (Page details) and `pwa/src/docs/DocsIndexView.tsx` (the Docs index), one mount each, which carry the ledger's take-up residue A23 to A27 for the next wave that edits `DocsHead.tsx` (`docs/superpowers/programs/native-docs-reader.md`), so R3 takes those carries too; `pwa/test/control-census.test.ts`, `pwa/test/tap-targets.test.tsx` (N7); `pwa/test/docs-scans.test.ts` (M4.EX16); `pwa/design/audit.mjs` (new chrome); new `pwa/test/docs-review-*.test.ts(x)`; the base spec (D-8766), rich-docs §6 pointers, README Docs section | R2 merged and installed, and the M-X3.16 device item recorded on both legs: R2.3's measurement page on the installed R2 release, on a phone's WebKit and on desktop Firefox. The coordinator raises the item for the operator when R2 is installed, and R3 dispatches only after both legs are recorded. A failing engine is a stop-and-ask; an engine that cannot be measured proceeds only on the operator's decision, recorded as unmeasured (coordinator's ruling on N1) |
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
  - `type ReviewCreateRefusal = 'too-large' | 'store-full' | 'store-unreadable' | 'not-durable' | 'bad-source'` (`auth-off` is the account gate's word, never this type's);
  - `interface ReviewSource { project: string; section: DocSectionSlug; path: string; branch: string; head: string; servedRef: string; baseCommit: string; fp: string; committedBlob: string | null }`;
  - `interface ReviewShareWire { id: string; source: ReviewSource; version: number; sharedAt: number; firstSharedAt: number; idleSince: number; lastViewedAt: number | null; pinned: boolean; sha256: string; size: number; credentialShapes: number; link: string | null; removed: { why: ReviewRemoval; at: number } | null; revoking: boolean }` (`revoking`: a removal is pending on disk, N2);
  - `interface ReviewCreateAnswer { ok: true; share: ReviewShareWire; replacedExpired?: true }` (optional and additive: present only when the create replaced an expired share of the same source, N9) and its single reader `replacedExpiredOf(a: ReviewCreateAnswer): boolean` (absent reads `false`), which every PWA consumer calls;
  - `isReviewToken(s: string): boolean`, `isReviewSource(x: unknown): x is ReviewSource`, built only from the docs grammars in `shared/docs.ts`, never a second one: `isDocsProject` for `project`, `DOC_SECTION_SLUGS` for `section`, `isDocsRelPath` for `path`, `parseDocsRef` for `branch` and `servedRef`, `isDocsCommit` for `head`, `baseCommit` and a non-null `committedBlob` (40 or 64 hex, so SHA-256 repositories are served), and `isDocsFingerprint` for `fp`.

- [ ] **Step 1: Write the failing test** `review-shared.test.ts`: each constant equals its Global Constraints value; `isReviewToken` accepts a 43-character base64url string and refuses 42, 44, `+`, `/`, `=` and `''`; `REVIEW_REMOVALS` equals `['revoked','expired','committed','retention','lost']`; `isReviewSource` refuses a section `programs`, a path with `..`, a 39-hex head and a 63-hex `fp`, and accepts both a 40-hex and a 64-hex `head`, `baseCommit` and `committedBlob` (a SHA-256 repository, F16).
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
  - `projectList(entries, tombstones, { armed, signedIn, origin }): ReviewShareWire[]` — `link` is `${origin}/review#${token}` only when both flags hold and the share is not `revoking`, else `null`.

- [ ] **Step 1: Write the failing tests**, one `it` per row, on a fixture whose `sharedAt`, `idleSince` and `firstSharedAt` are three distinct times (`sharedAt` 3 days before `idleSince`, `firstSharedAt` 5 days before it), so a decider reading the wrong field answers differently (N3): `expired` at exactly `REVIEW_IDLE_MS` after `idleSince`, live 1 ms before; a pinned share with `idleSince` 60 days ago and `firstSharedAt` 10 days ago is live; pinned at 30 days old is `retention`; `commitVerdict` is `committed` for a changed blob and for `null` to a blob, `keep` for an equal blob, `unmeasured` for a null tree, for a tree served at another ref, and for a missing entry, and for a same-path entry in another section; `viewDue` false at 59 999 ms and true at 60 000 ms; `admitCreate` gives `too-large` before `store-full`, refuses the 65th live share, refuses a new share whose size would take `storeBytes` one byte past `REVIEW_MAX_STORE_BYTES` and admits one that lands exactly on it, admits a re-share when the store is exactly full; `projectList` gives `link: null` dark and signed out, and `https://h.example/review#<43 chars>` when both hold; a share with `revoking: true` gets `link: null` armed and signed in (re-pass m8).
- [ ] **Step 2: Run** `ccrc test -- ./node_modules/.bin/vitest run test/review-policy.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** it and `test/rings`. Expected: `rings/totality.test.ts` FAILS first, naming `server/src/review/policy.ts` and `ports.ts` as reached by no row of the ring-context table (the new files are its planted control); add `review/**` to the C9 Docs row's server column of `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` and any rows the other rings suites ask for, then PASS (F10).
- [ ] **Step 5: Commit** `feat(review): deciders and the tree port (X3 R1.2)`.

### Task R1.3: L3 the review store

**Files:**
- Create: `server/src/review/store.ts`
- Modify: `server/src/config.ts` (`reviewStoreDir`, `~/.ccrc/review-shares`, defined once)
- Test: `server/test/review-store.test.ts` (fixture HOME, `mkTmp`)

**Interfaces:**
- Consumes: R1.1, R1.2.
- Produces `openReviewStore(dir: string, io: ReviewFs = nodeReviewFs, draw: () => Uint8Array = () => crypto.randomBytes(32)): Promise<{ ok: true; store: ReviewStore } | { ok: false; why: 'store-unreadable' }>`, and `interface ReviewStore`:
  - reads: `byToken(token): ReviewEntry | null` (SHA-256 then an in-memory map), `byId(id)`, `bySource(project, section, path, branch)`, `all()`, `tombstones()`, `bytesUsed()`, `readBytes(tokenHash, version): Promise<Uint8Array | null>` (tests and the sweep only), `openBytes(tokenHash, version): Promise<{ stream: Readable; size: number } | null>` (a read stream over a descriptor opened while the entry is live, so a later unlink lets an in-flight send finish with the old bytes);
  - writes, each through one in-process queue. Each re-reads the live entry inside the queue, then applies `expiryOf(entry, now)`: a dead entry is removed there, with its reason, and the write answers `{ ok: false; why: 'expired' }`. Each write but `put` names `tokenHash` and `expectRev` and answers `{ ok: false; why: 'stale' }` when the entry is gone or at another revision. `put(source, bytes, credentialShapes, now)` runs `admitCreate` inside the queue on the store's own counts: for a source with no live share, a new share (`id` 16 random bytes hex, token from `draw()`, base64url, re-drawn while the token itself matches any `CREDENTIAL_MASKS` shape (A2; the link's prefix matches none, so the token alone is checked), version 1), also when the source's share has just been removed as expired, answering `{ ok: true; entry; replacedExpired: boolean }`, where `replacedExpired` is true when the queue removed an expired share of that source or a tombstone of that source with `expired` or `retention` is still kept; for a source with a live share, the same token, `version + 1`, `sharedAt = now`, `idleSince = now`, and `firstSharedAt` kept. `markViewed(tokenHash, expectRev, now)` (when `viewDue`, sets `lastViewedAt = now` and `idleSince = now`: a view moves the idle clock), `setPinned(tokenHash, expectRev, pinned, now)` (pin leaves `idleSince` as it is; unpin sets `idleSince = now`; neither touches `firstSharedAt`), `remove(tokenHash, expectRev | 'any', why, now)` (dead in memory first, so `byToken` answers null before any disk act; then the tombstone, with the reason and no token, written by temporary name, `fsync`, rename and a directory `fsync`; then the index unlinked and the directory `fsync`ed; then the bytes unlinked and the directory `fsync`ed; each later act runs whether or not an earlier one failed), `retryPending(now)` (the sweep's call: re-runs each pending removal's remaining acts), `purgeTombstones(now)` (never deletes a tombstone while its index entry or bytes file exists);
  - **failure answers** (coordinator's ruling on N2), every write: `put` that fails before its index rename changes nothing and answers `{ ok: false; why: 'not-durable' }`; `markViewed` that cannot write keeps the view in memory and answers `{ ok: true; durable: false }`; `setPinned` that cannot write changes nothing and answers `not-durable`; `remove` answers `{ ok: true; entry; why }` once either unlink has landed, with `why` replaced by `lost` when the tombstone did not land, or `{ ok: false; why: 'not-durable'; entry }` when no disk act landed, keeping the entry revoke-pending (null to `byToken` and to `bySource`, `revoking: true` in `all()`); an act has landed when its call and the directory `fsync` after it both succeeded; a removal with any act left stays in the pending set until `retryPending` finishes it; `put` for a source with a pending removal first runs `retryPending` for it inside the queue and answers `not-durable` while it has not landed, so one source never has two index entries and a pending entry's token is never reused (re-pass I1); `purgeTombstones` that cannot unlink keeps the tombstone for the next pass;
  - layout and commit point as spec §4: `<tokenHash>.v<N>.html`, then `<tokenHash>.json`, each by temporary name, `fsync`, rename; directory `fsync`; then the superseded `v<N-1>` unlinked and the directory `fsync`ed;
  - `ReviewFs` is the small set of file operations the store uses (`open`, `write`, `fsync`, `rename`, `unlink`, `readdir`, `readFile`, `stat`), so a test can record their order or fail one of them; `nodeReviewFs` is the real one.
- At open: create the directory 0700 if absent; prove it writable (a probe file written, `fsync`ed and unlinked), else `store-unreadable`; remove temporary files older than 60 s and every bytes file no index entry names; read every index file once; finish any removal whose tombstone exists beside its index entry, keeping the tombstone's reason; remove with `lost` any index entry whose bytes file is missing.

- [ ] **Step 1: Write the failing tests:** `put` then `byToken` returns the entry and `readBytes` gives identical bytes (SHA-256 compared); files 0600, directory 0700; no file name contains the token; a second `put` keeps the token, sets version 2, `sharedAt` and `idleSince` to its `now`, and keeps `firstSharedAt` equal to the first `put`'s `now` (N3); **the idle clock (N3)**: `markViewed` at `t` sets `lastViewedAt` and `idleSince` to `t`, and a second `markViewed` 30 s later changes neither; `setPinned(true)` leaves `idleSince`; `setPinned(false)` at `t` sets `idleSince` to `t`; after a pin, an unpin and a view `firstSharedAt` is unchanged; **`concurrent re-share`**: two `put` calls started together end at version 3, the index naming `v3` and `v3`'s bytes matching the second call; **`revoke during an open read`**: `markViewed(h, rev, now)` queued after `remove(h, rev, …)` answers `stale`, and a store re-opened from the same directory holds no entry for `h`; **`crash before the index rename`**: a re-share through a `ReviewFs` that fails the index rename leaves `v2`'s bytes on disk and the index naming `v1`, so a fresh `open` serves `v1` and deletes `v2`; a recording `ReviewFs` sees `put` rename the bytes before it writes the index; **`open while a removal is held`**: with `remove` paused inside a recording `ReviewFs` at its tombstone write, `byToken` already answers null; **tombstone purge**: `purgeTombstones` deletes a tombstone 7 days old and keeps one 6 days old; **token re-draw (A2)**: with a `draw` whose first answer encodes to a token holding a `genericSk` shape, `put` draws again and stores the second token; **`expiry is terminal`**: on a share whose `idleSince` is 7 days old and not yet swept, `setPinned` answers `expired` and removes it, and `put` for its source answers `replacedExpired: true` with a new token and version 1 while the old token finds nothing; **`concurrent create at the cap`**: with 63 live shares, two `put` calls for new sources started together admit exactly one and refuse the other `store-full`; a temporary file 61 s old is gone after `open`, one 10 s old stays; a directory at mode 000 gives `store-unreadable`; **Purge and durability (F6)**: after a re-share only `v2`'s bytes file exists; a recording `ReviewFs` sees `remove` write and `fsync` the tombstone, then unlink the index, then `fsync` the directory, then unlink the bytes, then `fsync` the directory, in that order; a `ReviewFs` failing the index unlink after the tombstone is written leaves a state that the next `open` finishes, with the tombstone's reason kept; an index entry whose bytes file is missing is removed `lost` at `open`, and its link finds nothing; the tombstone holds no 43-character token. **Write failures (N2)**: a `ReviewFs` failing the tombstone write: `remove` still unlinks the index and the bytes, answers `why: 'lost'`, and a re-opened store holds no entry and serves no bytes; a `ReviewFs` failing the index unlink: the tombstone and the bytes unlink land, the answer is `ok`, `byToken` is null, and a re-opened store removes the index entry, keeping the tombstone's `revoked`; a `ReviewFs` failing every act: `remove` answers `not-durable`, `byToken` is null, `all()` shows the entry `revoking: true`, and after the `ReviewFs` heals one `retryPending` finishes it; **purge keeps a guarded tombstone**: a tombstone 8 days old whose index entry still exists is kept by `purgeTombstones`, and deleted on the pass after the index is gone; a directory at mode 0500 (readable, not writable) opens `store-unreadable`, and so does a `ReviewFs` that fails only the probe's write; **pending removals and re-share (I1)**: with a removal pending after an all-fail `remove`, `put` for its source answers `not-durable` and the directory still holds one index entry for the source, and once the `ReviewFs` heals the same `put` finishes the removal and mints a new token, never the pending one; `projectList` gives a revoking share `link: null`; `put` with a failing bytes write answers `not-durable` and the previous version stays served; `setPinned` with a failing index write answers `not-durable` and `pinned` is unchanged; `markViewed` with a failing index write answers `durable: false` and `lastViewedAt` moved in memory.
- [ ] **Step 2: Run** `ccrc test -- ./node_modules/.bin/vitest run test/review-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `store.ts`.
- [ ] **Step 4: Run** it, `test/single-definition` and `test/rings`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): the store, one writer, never backed up (X3 R1.3)`.

### Task R1.4: L4 the sweep

**Files:**
- Create: `server/src/review/sweep.ts`
- Modify: `server/src/server.ts` (start the sweep with an adapter over `docs.readers`' tree read at the given ref, through the docs lanes; stop it on close; keep its handle as the decoration `app.reviewSweep`, so a test can stop it, N10)
- Test: `server/test/review-sweep.test.ts`

**Interfaces:**
- Consumes: R1.2 (`ReviewTreeReader`, `expiryOf`, `commitVerdict`), R1.3.
- Produces `startReviewSweep(store: ReviewStore, reader: ReviewTreeReader, now: () => number): { stop(): void; runOnce(): Promise<void> }`. One pass: `expiryOf` on every entry; then group the live ones by project and `source.servedRef`, one `reader.tree` per group, `commitVerdict` per entry; `remove(e.tokenHash, e.rev, why, now)` for each removal, with the revision the verdict read; `retryPending`; `purgeTombstones`. Runs at start and every `REVIEW_SWEEP_MS`; while the store's pending set is not empty, `retryPending` also runs every `REVIEW_PENDING_RETRY_MS`; `stop()` runs `retryPending` once before it clears the timers, and `buildServer`'s close calls `stop()`. `started: Promise<void>` settles when the start pass has run. The timer handles are fields, so this file is L4.

- [ ] **Step 1: Write the failing tests:** three shares at one served ref cost one `tree` call; a changed blob removes with `committed`; `{ok:false}` removes nothing, nor does a tree without the path; **`served ref, not the local branch`**: a share recorded at `refs/remotes/origin/b` is read at that ref, and a reader that answers a different blob for `refs/heads/b` is never asked; a share 30 days old is removed `retention` with no `tree` call; a re-share or a pin between the verdict and the `remove` survives (the `remove` names the revision the verdict read, and answers `stale`); a removal left pending by a failing `ReviewFs` is finished within `REVIEW_PENDING_RETRY_MS` once it heals, with no full pass; `stop()` with a pending removal and a healed `ReviewFs` finishes it before it returns; `stop` clears the timer (fake timers, no call after 2 × `REVIEW_SWEEP_MS`).
- [ ] **Step 2: Run** `ccrc test -- ./node_modules/.bin/vitest run test/review-sweep.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `startReviewSweep` and its wiring in `buildServer`.
- [ ] **Step 4: Run** it and `test/rings`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): the sweep (X3 R1.4)`.

### Task R1.5: L4 the read door, the gate, the census and the first amendments

**Files:**
- Create: `server/src/review/routes.ts`
- Modify: `server/src/server.ts` (one line registering `registerReviewOpenRoute`, which builds the read door's own plugin inside `review/routes.ts`: its own `bodyLimit` of `REVIEW_OPEN_BODY_BYTES`, its own `setErrorHandler` answering 413 `too-large` past the limit and the one 404 for every other body, parse and content-type failure, and the marker check first; the page routes are R2.2's, the owner doors R3.1's); `server/src/auth/gate.ts` (`EXEMPT` gains `POST /api/review/open`, class 9 "draft review by capability: the token in the body is the credential; the door reads no session", and the header's class count); `server/test/auth-gate.test.ts` (nine classes); `server/test/box-token-census.test.ts` (`REVIEW_SRC`, hand-kept `REVIEW_DOORS`, both directions, a planted token call seen, the never-read scan); `README.md` (auth paragraph: class 9); the base spec (D-8765's sentences, below), claimed at R1's run-open
- Test: `server/test/review-routes.test.ts`, `server/test/review-backup.test.ts`

**Interfaces:**
- Consumes: R1.1-R1.4.
- Produces the read door of spec §5 (no route of R1 can create a share, so an R1 release hands out no link; tests seed the store through its own interface):
  - `REVIEW_MARKER_HEADER = 'x-ccrc-review'` with value `'1'` (L0, `shared/docsReview.ts`, which R2's page imports), checked before any token lookup;
  - `POST /api/review/open` body `{ token }`, `bodyLimit` `REVIEW_OPEN_BODY_BYTES` — 200 `application/octet-stream`, `Content-Disposition: attachment`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, and `x-ccrc-review-shared-at`, `x-ccrc-review-version`, `x-ccrc-review-idle-days`; otherwise 404 `{"ok":false,"error":"not-found"}` with the same four headers; 429 `busy` past `REVIEW_OPEN_STREAMS_PER_SHARE` sends of one share or `REVIEW_OPEN_STREAMS` in all; the bytes are piped from `openBytes`, the slot is released on the reply's `close` event (finish or abort), and a send whose socket accepts no bytes for `REVIEW_SEND_IDLE_MS` is destroyed (a no-progress timeout, reset by every write the socket drains, never a total deadline); no rate-limit config.

- [ ] **Step 1: Write the failing route tests** (`buildServer` on a fixture HOME, armed and dark, the store seeded through `put`): open with the token is 200, byte-identical to the seeded bytes, with each header; **M-X3.1**: unknown, 42-character, revoked and expired tokens, a request without the marker header, malformed JSON and a `text/plain` body all give byte-identical 404s, while a 257-byte body gives 413 `too-large` (the F1 ruling's 413) (status, headers less `date`, body), and the marker-less, malformed and oversize ones make zero store lookups (a store whose `byToken` counts calls); these cases run on the real `buildServer`, armed with no cookie and dark; **read-time expiry (M-X3.3, N10)**: on a `buildServer` whose review sweep is stopped once `app.reviewSweep.started` settles (`await app.reviewSweep.started`, then `app.reviewSweep.stop()`, R1.4), a share seeded after that with `idleSince` 7 days old and unswept answers the one 404, so only the read door's own `expiryOf` can have refused it; open sets `lastViewedAt` and a second open 30 s later does not rewrite it; `remove` through the store then open is 404 with no tick between; open behaves the same with a cookie and with the box token; open makes zero `runCcd` calls (a `runCcd` that throws). **Grammar first (T5)**: a 257-byte body (413) and a 44-character token (the one 404) each make zero `ReviewFs` calls and zero `byToken` calls. **Busy rows**: with two sends of share A held open, a third open of A is 429 `busy` while an open of share B is 200; aborting one held send lets the next open of A through (the slot is released on close); a reader that stops reading is destroyed `REVIEW_SEND_IDLE_MS` after its last drained write and its slot released, while a reader draining 16 KiB every 20 s is never destroyed (fake timers); with 16 sends held across eight shares, a ninth share's open is 429. **The mask (A2)**: a seeded copy holding a `genericSk`-shaped string comes back from the read door byte for byte (its octet-stream type passes the egress filter). **Revoke during a send**: a send of version 1 started before `remove` completes with version 1's bytes exactly, and the next open is the one 404. **Streamed (F5)**: a spying store sees the read door call `openBytes` and never `readBytes`, and the reply's payload is that stream.
- [ ] **Step 2: Write the census and gate tests**: `REVIEW_DOORS` equals the one registration; none consults the box token; only the open door is `EXEMPT`, with "reason 9"; the never-read scan finds none of `req.cookies`, `checkMailToken`, `requireMailToken`, `runCcd`, `ReviewTreeReader` or `docs.readers` in the open door's handler, with a planted control for each; `auth-gate.test.ts`'s class list has nine entries and `gate.ts`'s number words read nine.
- [ ] **Step 3: Write M-X3.7**, `review-backup.test.ts`: it reads every site that copies into a backup, `ccd/ccrc#_upd_backup` (whose own body copies `coord.db` and the Overlord's store), `#_upd_backup_set`, `#cmd_backup`, `deploy/deploy.sh`'s backup lines and the member list of `deploy/coordination-snapshot.mjs`, and fails if any copied path is `~/.ccrc/review-shares`, `~/.ccrc` itself, `$HOME`, or a glob that covers any of them, with a planted control in each of the five sites (F11).
- [ ] **Step 4: Run** `ccrc test -- ./node_modules/.bin/vitest run test/review-routes.test.ts test/review-backup.test.ts test/auth-gate.test.ts test/box-token-census.test.ts`. Expected: FAIL on each new case.
- [ ] **Step 5: Implement** `registerReviewOpenRoute(app, deps)` in `routes.ts`; register its plugin after the docs plugin in `buildServer`; add the `EXEMPT` row and the README sentence; write D-8765's amendments into the base spec, the README-contents bullet among them, each marked "(amended <date>; draft review, X3, D-8765)".
- [ ] **Step 6: Run** those four files and `test/single-definition`, `test/rings`, `test/citations.test.ts`, `test/anchors.test.ts`, `test/docs-parity.test.ts`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(review): the read door, gate class 9, census and D-8765 (X3 R1.5)`.

---

## Wave R2 — the review page

### Task R2.1: The page

**Files:**
- Create: `pwa/review.html`, `pwa/src/review/main.ts`, `pwa/src/review/review.css` (no React; imports only `shared/docsReview.ts`, and R2.3's `./labFixture`)
- Modify: `pwa/vite.config.ts` (`build.rollupOptions.input`, absent today, becomes `{ index: 'index.html', review: 'review.html' }`, so the map names the shell too (a1 (e)); the shell's key is `index`, so its entry chunk and sheet keep their `assets/index-*` names, which `test/fonts-built.test.ts` matches, and R2.1 Step 4 runs that file and `test/reader-built.test.ts` beside its own; workbox `globIgnores` gains `review.html`); the page stays in the built `dist-pwa/`, so the release tarball, the fallback deploy and the install checks carry it with no change; the base spec's M5.16 and the rich-docs spec's A2b and M8.10 (D-8767's sentences), claimed at R2's run-open; `pwa/test/docs-scans.test.ts` (`new DOMParser(` and `.parseFromString(` allowed in `pwa/src/review/main.ts` beside `parse.ts`, each with a planted control); `pwa/test/reader-lab-scans.test.ts` (rule 2's iframe and srcdoc allowance outside `pwa/src/docs` gains `pwa/src/review/main.ts` beside `readerLab/frames.ts`, with a planted control: the same iframe in `pwa/src/review/other.ts` is red; and rule 3, which refuses any `setAttribute('sandbox', x)` but `LAB_SANDBOX` and any `.sandbox =` across `pwa/src`, gains `pwa/src/review/main.ts` setting it to the empty string literal only, `setAttribute('sandbox', '')`, with two planted controls: `'allow-scripts'` there and `''` in `other.ts` each red; the empty value is the strictest sandbox, so no lab frame's `allow-scripts` changes, re-pass m13); the architecture spec's C9 Docs row, PWA column, gains `review/**`
- Test: `pwa/test/review-page.test.ts` (jsdom), `pwa/test/review-built.test.ts` (the built output)

- [ ] **Step 1: Write the failing tests** (**M-X3.10**): after load, `location.hash` is empty and no request has been made; the only control is "Open draft", and the POST to `/api/review/open` happens only on its click, with the token in the JSON body and the header `REVIEW_MARKER_HEADER: 1` imported from `shared/docsReview.ts`; on 200 the frame's `sandbox` attribute is the empty string and its `srcdoc` equals the response text; the banner reads "Draft, not committed. Shared for review on {date}. Read-only."; "Links in this copy" lists each `https:` href of the bytes once, as `<a rel="noreferrer noopener" target="_blank">`, and no `javascript:` or `data:` href; a 404 shows exactly "This link has expired, was revoked, or never existed." and no frame; a load with no hash shows exactly "To open this draft again, use the link you were sent." and makes no request; after an open, `sessionStorage`, `localStorage` and `document.cookie` hold nothing the page wrote, and `history.state` holds no token.
- [ ] **Step 2: Run** `cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/review-page.test.ts test/docs-scans.test.ts test/reader-lab-scans.test.ts` and `cd ../server && ccrc test -- ./node_modules/.bin/vitest run test/rings`. Expected: FAIL, the last two on the unmapped and unallowed new file.
- [ ] **Step 3: Implement** the page and its entry.
- [ ] **Step 4: Write and run** `pwa/test/review-built.test.ts`, which runs the app's own `vite build` into a temporary directory in `beforeAll`, as `test/reader-built.test.ts` and `test/fonts-built.test.ts` do, and reads the output: the built tree holds `review.html`, and the generated service worker's precache manifest names no `review.html` (A0, N8; `test/browser-dist.test.ts` pins the hermetic run with a stand-in builder, so a built-output row cannot live there). Run it red before `globIgnores` gains the page, then green; then run the other tests of Step 2. Expected: PASS.
- [ ] **Step 5: Write** D-8767's amendments into the three specs (base, rich-docs and reader lab), each marked "(amended <date>; draft review, X3, D-8767)", and run `test/docs-scans.test.ts` again. Expected: PASS.
- [ ] **Step 6: Commit** `feat(docs): the review page and D-8767 (X3 R2.1)`.

### Task R2.2: The page routes and the service worker

**Files:**
- Modify: `server/src/review/routes.ts` (`GET /review` reads the built `review.html` from the PWA root itself, with `fs.readFile` once at registration or per request, and sends those bytes with `reply.send`: it never calls the static plugin's `reply.sendFile`, which runs the same `allowedPath` filter and the plugin's `setHeaders`, so it would refuse its own page or overwrite `no-store` with `no-cache` (N6); the spec §3.5 policy header, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`; `GET /review.html` and `GET /review/` always 404, never the shell; a query string on `/review` reaches the page route, as Fastify routes on the path), `server/src/pwaStatic.ts` (`pwaStaticOptions` gains `allowedPath(pathName, root, request)`, refusing the built `review.html` after decoding, `path.posix.normalize` and lower-casing, so a case-insensitive file system cannot serve `/Review.html` (own-2)), `server/test/pwa-static-cache.test.ts` (the filter's unit rows), `server/src/auth/gate.ts` (`GET /review` joins class 9), `server/test/auth-gate.test.ts`, `box-token-census.test.ts` (`REVIEW_DOORS` four: R1.5's door, the page, `/review.html` and `/review/`); `pwa/src/lib/sw-denylist.ts` (own list gains `/^\/review(?:[/?]|$)/`: workbox's `NavigationRoute` tests its denylist against `pathname + search`, so a link tracker's `?utm_source=` must still be denied, N5), `pwa/test/sw-denylist.test.ts`
- Test: `server/test/review-routes.test.ts`

- [ ] **Step 1: Write the failing tests:** the `GET /review` CSP header equals the spec string exactly, with no `'unsafe-inline'` in `script-src` and no `allow-` token; it also carries `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY`, one case each; the route answers the same bytes with and without a cookie, armed and dark; `GET /review.html` is 404; **the filter (N6)**, in `pwa-static-cache.test.ts`: `pwaStaticOptions(root).allowedPath` answers false for `/review.html`, `/Review.HTML`, `/review%2Ehtml` and `/assets/../review.html`, and true for `/index.html` and `/assets/x.js`; **characterisation (A0)**: `GET //review.html`, `GET /assets/../review.html`, `GET /review%2Ehtml` and `GET /Review.html` never answer the page's bytes, dark or armed, on the real `buildServer` with the built tree (the router and the plugin's own path checks already refuse the first three, so these rows describe today and cannot red the filter alone); `GET /review` answers `Cache-Control: no-store` with the filter in place (a route built on `sendFile` fails it); `GET /review?utm_source=x` answers the page with its CSP header, and `GET /review/` is 404 with no shell bytes (N5); **M-X3.12**: `swDenylist(undefined)` matches `/review`, `/review/` and `/review?utm_source=x`, and not `/reviews` or `/reviews?x` (the planted control: the old `/^\/review(\/|$)/` fails the `?utm_source=x` row).
- [ ] **Step 2: Run** `cd server && ccrc test -- ./node_modules/.bin/vitest run test/review-routes.test.ts test/auth-gate.test.ts test/box-token-census.test.ts` and `cd ../pwa && ccrc test -- ./node_modules/.bin/vitest run test/sw-denylist.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two routes and the denylist entry.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): the review page routes (X3 R2.2)`.

### Task R2.3: The measurement page and the real browser

This task builds M-X3.16's measurement page (coordinator's ruling on N1). It is the review page itself in a lab mode, so its policy stack is the real one: `/review#lab` makes the page clear the hash as usual, post nothing to the read door and make no request at all, and mount a committed fixture through the same mount code it uses for a copy. The fixture's two copies are Export's own bytes: `buildExport`'s output for two committed inputs, a Markdown page and a mockup page, so each copy carries its own `DOCS_EXPORT_CSP` meta as the first head child, its generator meta and, for the mockup, Export's real wrapper with its nested `<iframe sandbox="" srcDoc>`. The one difference from the builder's bytes is stated and tested: a `<script>` canary is inserted after the build (the builder strips scripts, so no real copy has one), which would recolour a swatch if it ran. The page draws, outside the frame, one line per check with a reference beside it: the inline style, the `data:` image, the `data:` font, the nested mockup frame, the script canary unchanged, and the frame unchanged after a tap on the copy's link. Each line has three answers, "Drew" (or "Unchanged"), "Did not draw" (or "Changed") and "Cannot tell", and reads not measured until answered. The script and link lines hold only once the same frame's load marker reads "Drew", so nothing that did not load reads as a pass (the reader lab's rule, reader lab design §1: every check has a positive signal that it ran). The page then shows one copyable result block, `review-lab 1 · <engine> · <OS class>` and one fixed key per line (`inline-style`, `data-image`, `data-font`, `nested-frame`, `script-off`, `link-inert`), whose keys never change meaning. The reader lab, the surface that runs E17 and E18 on a device, gains one anchor, "Draft review frame (M-X3.16)", to `/review#lab` with `target="_blank" rel="noopener noreferrer"` (an anchor, since `reader-lab-scans` rule 1 forbids `window.open` there); the lab's own ten lines, probes and result grammar are unchanged. An installed R2 release therefore opens the page with no share and no create door. The device item's answer records the result block per engine.

**Files:**
- Create: `pwa/src/review/labFixture.ts` (a data module: the two copies' bytes as string constants, and the canary's insertion point; no other code); `pwa/test/fixtures/review-lab/` (the two committed inputs); `pwa/test/review-lab-fixture.test.tsx` (builds both copies with `buildExport` from the committed inputs and asserts `labFixture.ts` holds exactly those bytes plus the one canary insertion; with `CCRC_WRITE_FIXTURE=1` it writes the file instead, its one writer); `pwa/browser/docs-review.browser.test.ts`
- Modify: `pwa/src/review/main.ts` (the lab mode; it may import `./labFixture` beside `shared/docsReview.ts`); `pwa/src/screens/ReaderLab.tsx` (the one anchor) and `pwa/test/control-census.test.ts` (its entry, keyed by `screens/ReaderLab.tsx`); `pwa/test/reader-lab-scans.test.ts` (rule 2's allowance gains `pwa/src/review/labFixture.ts` by exact path, beside R2.1's `main.ts`, with its own planted control); `pwa/test/review-page.test.ts` (lab mode: hash cleared, no request of any kind, the fixture's bytes in the frame's `srcdoc`, each line not measured until answered, the script and link lines not measured while the load marker is unanswered, the result block's keys); `pwa/browser/app.ts` (a `reviewServer` mode answering `/review`, `/review.html` and `/api/review/*` with exactly R2.2's headers and R1.5's bodies, served from a store the test seeds, and an option for a context with `serviceWorkers: 'allow'`)

- [ ] **Step 1: Write the failing browser tests:** a snapshot holding `<script>` and an `onerror` image runs neither (a global the payload would set stays unset) and `document.cookie` cannot be read from inside the frame; a 10 MiB snapshot opens and its last element is in the frame's DOM; clicking a link inside the frame does not navigate the frame, and the listed link opens a new tab whose request carries no `Referer`; **`installed PWA does not answer /review`**: with the built service worker installed and controlling the page, a navigation to `/review` reaches the server (the mode records it) and the response carries the CSP header.
- [ ] **Step 1b: Write the measurement M-X3.16 (F9, N1)** in the same file, as its first case, against the measurement page this task builds: opened at `/review#lab` under the page's exact header policy, the Markdown copy's inline `<style>`, `data:` PNG and `data:` font each draw (computed style, `naturalWidth`, `document.fonts.check`, read through the test driver's frame handle), the mockup copy's nested srcdoc frame draws its swatch, the canary `<script>` in either frame leaves its swatch unchanged, and a link click inside either leaves the frame's URL unchanged. It records the engine name with each verdict. The browser leg launches Chromium only, so R2.3 records Chromium. The phone's WebKit and desktop Firefox are measured on the same page, opened from the reader lab, on the installed R2 release, as one device item the coordinator raises for the operator; R3 dispatches only after both legs are recorded. A failing engine stops with an ask; an engine that cannot be measured (no device) is the operator's decision, recorded as unmeasured, never assumed; the page's policy is never widened to pass. DR-11 re-runs the page on all three engines as acceptance.
- [ ] **Step 2: Run** `cd pwa && ccrc test -- ./node_modules/.bin/vitest run --config vitest.browser.config.ts browser/docs-review.browser.test.ts`. Expected: FAIL before the harness mode exists, then on any guard removed.
- [ ] **Step 3: Implement** the harness mode and option.
- [ ] **Step 4: Run** it and the existing browser files that import `app.ts` (`browser/` whole, through `ccrc test`). Expected: PASS.
- [ ] **Step 5: Commit** `test(docs): the review page in a real browser (X3 R2.3)`.

---

## Wave R3 — owner side

R3 is the first release that can make a link, so it follows R2: the page and its door are already installed, and a service worker installed before R2 has had a release to update.

### Task R3.1: The owner doors

**Files:**
- Modify: `server/src/review/routes.ts` (`registerReviewOwnerRoutes`, whose create handler calls the account gate first with `{ cap: null }`), `server/src/server.ts` (a second plugin for the owner doors, without the docs provenance policy), `server/test/auth-gate.test.ts` (`FLAG_AWARE` gains the create door, as the account routes are listed), `server/test/secret-mask.test.ts` (its GET inventory gains the list), `server/test/box-token-census.test.ts` (`REVIEW_DOORS` eight: R1's open door, R2's three page routes, these four)
- Test: `server/test/review-routes.test.ts`

**Interfaces:**
- Consumes: R1.1-R1.5.
- Produces:
  - `POST /api/review/shares` — body `{ source: ReviewSource; bytes: string /* base64 */; credentialShapes: number }`, `bodyLimit` = `Math.ceil(DOCS_EXPORT_MAX_BYTES * 4 / 3) + 4096`; `ReviewCreateAnswer` (R1.1: `{ ok: true; share; replacedExpired?: true }`, the flag from the store's `put`) or `{ ok: false; why }` (the account gate's `auth-off` dark, 413 `too-large`, 409 `store-full`, 503 `store-unreadable`, 400 `bad-source`);
  - `GET /api/review/shares?project=&section=&path=` (each optional; all absent lists every share) — `{ ok: true; shares }`, 400 `bad-query`;
  - `POST /api/review/shares/:id/pin` body `{ pinned: boolean }` — `{ ok: true; share }`, 404 `unknown-share`, 409 `expired` (the store's `expired`: it removed the share), 409 `stale` (the store's `stale`: another write moved its revision first);
  - `POST /api/review/shares/:id/revoke` — calls `remove(tokenHash, 'any', 'revoked', now)` and answers `{ ok: true; share }` with `share.removed` set to whatever removed it (`revoked`, or `expired`/`retention` found inside the queue), or, for a share already gone, the same answer built from its tombstone; `share.removed.why` is `lost` when the tombstone did not land though an unlink did; 503 `{ ok: false; why: 'not-durable'; share }` with `share.revoking` true and `link: null` when no disk act landed (the link already 404s, the retry timer retries); 404 `unknown-share` only when neither the share, a pending removal nor a tombstone exists. Create answers 503 `not-durable` and pin 503 `not-durable` from the store's same word.

- [ ] **Step 1: Write the failing tests** (real `buildServer`): create dark answers exactly what the account gate answers for `auth-off` (its status and body, measured, not restated); create armed without a session is 401; create armed and signed in gives a share whose `link` is `https://<origin>/review#<43 chars>`, and opening it through R1's door gives the uploaded bytes; the list on a dark gate, over shares made armed, gives every `link` as `null`; a snapshot of `DOCS_EXPORT_MAX_BYTES + 1` bytes is 413; the 65th live share is 409; `REVIEW_DOORS` equals the eight registrations and none of the four is `EXEMPT`; with R1.3's re-draw in place, the create answer's `link` equals `https://<origin>/review#<token>` byte for byte after the answer mask runs (A2); `server/test/secret-mask.test.ts`'s GET inventory, which reads `app.get('/api…')` registrations only, gains `GET /api/review/shares`, classified as not carrying session text, while the three owner writes are masked by `answerMasked` as every write is (a1 (d)); the list with `section=programs` or a path holding `..` is 400 `bad-query`; pin and revoke of an unknown id are 404 `unknown-share`; pin of an idle-expired, unswept share is 409 `expired` and the share is gone after; pin with a revision another write has just moved is 409 `stale`; revoke of an idle-expired, unswept share and revoke of a share the sweep already removed both answer 200 with `removed.why` `expired`; revoke through a store whose every disk act fails answers 503 `not-durable` with `share.revoking` true, and the link 404s at once; a create for a file whose expired share the sweep already removed answers `replacedExpired: true`, and a first create's answer has no `replacedExpired` key (N9).
- [ ] **Step 2: Run** `cd server && ccrc test -- ./node_modules/.bin/vitest run test/review-routes.test.ts test/auth-gate.test.ts test/box-token-census.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the four doors.
- [ ] **Step 4: Run** them. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): the owner doors (X3 R3.1)`.



### Task R3.2: Export's builder gains `purpose`

**Files:**
- Modify: `pwa/src/docs/export/buildExport.tsx` (`ExportInput.purpose?: 'file' | 'review'`, default `'file'`; the success arm of `ExportResult` gains `inlined: readonly ExportInlinedFile[]`, `omitted: readonly { path: string; why: ExportMissing | 'not-inlined' }[]` (a Markdown row carries Export's own `ExportMissing` word; a mockup row carries `not-inlined`, because `ExportMockupFacts.omitted` is a list of paths with no reason) and `links: readonly string[]`, for every body kind), `provenance.ts` (the review banner lead), `policy.ts` (the `ccrc:purpose` meta name)
- Test: `pwa/test/docs-export.test.tsx`

- [ ] **Step 1: Write the failing tests:** with `purpose: 'review'` the file holds `<meta name="ccrc:purpose" content="review">` and its banner starts "Shared for review. Read-only."; with no `purpose` the bytes equal today's on one Markdown and one mockup fixture; `DOCS_EXPORT_CSP` is unchanged. **The new fields (F8)**: a Markdown export with two held images, one of them a draft, and one image that timed out lists both held images in `inlined` (the draft marked) and the timed-out one in `omitted` with `timed-out`; its `links` lists every `href` in the built bytes, in order, and nothing else (checked by parsing the bytes); a mockup export's `inlined` equals its `mockup.inlined`, and its `omitted` paths equal `mockup.omitted` in order, each with `why: 'not-inlined'`; a text export has all three empty.
- [ ] **Step 2: Run** `cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/docs-export.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the optional field and the two text changes.
- [ ] **Step 4: Run** every `test/docs-export*` file and `test/mockup-export.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(docs): Export's builder takes a review purpose (X3 R3.2)`.

### Task R3.3: The review action in Page details

**Files:**
- Create: `pwa/src/docs/review/shareForReview.ts` (L1, pure), `pwa/src/docs/review/upload.ts`, `pwa/src/docs/review/ReviewConfirm.tsx`
- Modify: `pwa/src/docs/DocsHead.tsx`, the Page details host (one mount of the action row), `pwa/test/control-census.test.ts` (the row's entry, keyed by `docs/DocsHead.tsx`; existing entries unchanged), `pwa/test/tap-targets.test.tsx` (its compact-head floor rows run unchanged), `pwa/src/lib/api.ts` (`reviewCreate`, `reviewList`, `reviewPin`, `reviewRevoke`), `pwa/test/docs-scans.test.ts` (M4.EX16: `ReviewConfirm.tsx` may `import()` `../export/buildExport` (from `pwa/src/docs/review/`, a1 (f)), and `upload.ts` may receive its bytes, each with a planted control; `new Blob(` stays in `objectUrls.ts` only)
- Test: `pwa/test/docs-review-share.test.tsx`

**Interfaces:**
- Consumes: R3.1's wire, R3.2, `shared/redact.mjs#redactCount`, `shared/api.ts#credentialMaskSource`.
- Produces: `reviewOfferFor(tree, page, entry, opened, exportReady): { offered: true } | { offered: false; sentence: string }`; `credentialCount(exportText: string): number` — replaces each `data:` payload in place: a raster type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, `image/bmp`, `image/x-icon`) by nothing, any other type (`image/svg+xml`, `text/css`, `font/*`, `application/font-*`) by its decoded text (base64 or percent-encoded, decoded as UTF-8 with replacement), recursively: a decoded text's own `data:` payloads are replaced the same way, because Export nests them (a stylesheet's @imported sheets, SVGs and fonts are themselves `data:` URLs inside it, `pwa/src/docs/mockup/exportMockup.ts#nestedSheet`), to at most `MOCKUP_MAX_CSS_DEPTH + 1` levels (imported from `pwa/src/docs/mockup/policy.ts`, never a second literal: the exporter's own sheet depth, plus the deepest sheet's own payloads); a non-raster payload still holding a `data:` payload past that bound adds 1 to the count, so it is held for the owner, never passed unread (N4); then returns `redactCount('linear-egress', text, { genericSk: credentialMaskSource('genericSk'), jwt: credentialMaskSource('jwt') }).masked`.
- Exact sentences: action "Share a draft for review"; confirm title "Share a private copy for review"; hold "This draft holds {n} strings that look like credentials." with "Go back" and "Share anyway"; done "Anyone with this link can read this copy until {date}." No Share sentence changes.

- [ ] **Step 1: Write the failing tests:** the action row shows in Page details only when the leaf opens a draft, a new file included, and never in the Share sheet; Share's own suites (`docs-share.test.ts`, `docs-share-sheet.test.tsx`) run unchanged and green, so `share-drafts`, M4.SH1 and M4.SH3 still hold; it is disabled with Export's sentence whenever Export is; the confirm lists every inlined file with size and draft mark, every omitted file and every link target from the `ExportResult`; a fake token of valid shape in the Markdown text holds the share, and "Share anyway" uploads with `credentialShapes: 1`; the same token inside an inlined draft stylesheet (a base64 `data:text/css`), inside an inlined SVG, and inside a font payload each count 1; **nested payloads (N4)**: the same token inside a sheet @imported by an inlined sheet (a base64 `data:text/css` inside a base64 `data:text/css`), inside an SVG referenced from an inlined sheet, and at the bound's deepest level each count 1; a payload nested one level past the bound counts at least 1; the same token inside a mockup's inline script counts 0, because the built export holds no script (asserted on the bytes); a PNG payload whose base64 happens to contain the shape counts 0; **a PNG whose `tEXt` chunk holds the token** (so its decoded bytes hold it as ASCII) counts 0, because raster payloads are cut, never decoded (N10); **M-X3.14**: the upload is not called before the check settles; **M-X3.13**: the upload's bytes equal `buildExport`'s (SHA-256); after success the confirm offers Copy link through `copyText`, and M4.SH7 still finds one `clipboard.writeText(` under `pwa/src/docs`.
- [ ] **Step 2: Run** `ccrc test -- ./node_modules/.bin/vitest run test/docs-review-share.test.tsx test/docs-share.test.ts test/docs-share-sheet.test.tsx test/docs-scans.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the module, the upload and the action row.
- [ ] **Step 4: Run** them, `test/control-census.test.ts` and `test/tap-targets.test.tsx` (N7). Expected: PASS, with only the new row's census entry added. If the row cannot be placed without changing an existing census entry, a compact-head floor row or a tap, one-bar or desktop-fit budget, stop and ask; never edit them.
- [ ] **Step 5: Commit** `feat(docs): Share a draft for review (X3 R3.3)`.

### Task R3.4: The owner's controls and the newer-draft notice

**Files:**
- Create: `pwa/src/docs/review/ReviewRows.tsx`, `ReviewList.tsx`, `reviewWords.ts` (L1: every sentence, and `reviewDate(ms: number): string`, the one `{date}` formatter, `new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })` in the browser's time zone, so 2026-11-26 reads "26 Nov 2026"; "Stops working {date}" shows `min(idleSince + REVIEW_IDLE_MS, firstSharedAt + REVIEW_RETENTION_MS)`)
- Modify: `pwa/src/docs/DocsHead.tsx` (the Page details host) and `pwa/src/docs/DocsIndexView.tsx` (the Docs index), one mount each; `pwa/test/control-census.test.ts` (the share rows' controls, keyed by their files); `pwa/test/tap-targets.test.tsx` (run unchanged); `pwa/design/audit.mjs` (`GROUNDS` for the new chrome)
- Test: `pwa/test/docs-review-owner.test.tsx`

- [ ] **Step 1: Write the failing tests:** a leaf with a live share whose `source.fp` differs from the page's `fp` shows "Shared for review on {date}. A newer draft is available." and Re-share, which opens the same `ReviewConfirm` as a first share (the file and link list, then the credential hold) and only after its confirm uploads and shows version 2; a re-share whose new draft holds a credential-shaped string is held until "Share anyway"; an equal `fp` shows no notice; `reviewDate` of 2026-11-26T12:00 local reads "26 Nov 2026"; "Stops working {date}" shows the idle end when it comes first and the 30-day end when that comes first; Pin turns "Stops working {date}" into "Pinned"; Revoke asks once, then the row reads "Revoked"; Re-share of a file whose share expired shows "The old link has expired and stays dead. This is a new link." and the new link, read through `replacedExpiredOf` (N9), and an answer without the key shows no such sentence; Pin on an expired share shows "Expired: no view for 7 days" and no pinned state; each removal shows its exact sentence ("Revoked", "Expired: no view for 7 days", "Removed: committed on {branch}", "Removed: 30-day limit", "Removed: its copy could not be read"); a share with `revoking: true` shows "Revoking. The link already answers nothing; ccrc keeps retrying." and no Copy link; the index list shows live and removed shares, and no Copy link when `link` is null.
- [ ] **Step 2: Run** `ccrc test -- ./node_modules/.bin/vitest run test/docs-review-owner.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the rows, the list and the words.
- [ ] **Step 4: Run** it, `test/contrast.test.ts`, `test/control-census.test.ts`, `test/tap-targets.test.tsx` and the design audit. Expected: PASS; the same stop-and-ask as R3.3 Step 4 (N7).
- [ ] **Step 5: Write** D-8766's amendments into the base spec (§4.13's arm sentence, M4.EX16, §5.4's only-consumer sentence, §5.6.9's Wrapper sentence and M5.16's parenthetical), each marked "(amended <date>; draft review, X3, D-8766)", and point rich-docs §6 rows G11 and "Draft review by link" at this feature's spec; update the README Docs section. Run `cd server && ccrc test -- ./node_modules/.bin/vitest run test/docs-parity.test.ts test/citations.test.ts test/anchors.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(docs): owner controls for shared drafts and D-8766 (X3 R3.4)`.

---

## Wave R4 — signed-in comments (follow-on)

The operator adopted comments from signed-in readers only; spec §3.6 and its threats C1-C5 govern. Every field is additive: an R1-R3 build that reads an index entry with `comments` ignores it, and R4 reads an entry without it as no notes.

### Task R4.1: Server: the comment vocabulary, store and doors

**Files:**
- Modify: `shared/docsReview.ts` (`REVIEW_MAX_COMMENTS = 100`, `REVIEW_COMMENT_MAX_CHARS = 2000`, `interface ReviewComment { at: number; version: number; text: string }`, `ReviewShareWire.comments?: readonly ReviewComment[]`); `server/src/review/policy.ts` (`admitComment`); `server/src/review/store.ts` (`addComment`, through the same queue and version re-read; a tombstone keeps only the count); `server/src/review/routes.ts` (two doors); `server/test/auth-gate.test.ts` (`FLAG_AWARE` gains both comment doors, the thread and the comment, which both call the account gate); `server/test/box-token-census.test.ts` (`REVIEW_DOORS` ten (R3's eight and these two); a scan that no `server/src/review/**` file imports a forge or pull-request module, with a planted control)
- Test: `server/test/review-comments.test.ts`

**Interfaces:**
- Produces:
  - `admitComment(e, text): { ok: true; text: string } | { ok: false; why: 'too-long' | 'too-many' }` — removes control characters other than `\n`, then measures; both comment doors call the account gate first, the one writer of `auth-off`;
  - `POST /api/review/thread` body `{ token }` — `{ ok: true; comments }`, the account gate's `auth-off` answer dark (measured, not restated: 501 at this writing), the read door's one 404;
  - `POST /api/review/comment` body `{ token, text }` — `{ ok: true; comments }`, the account gate's `auth-off` answer dark (measured), 400 `too-long`, 409 `too-many`, the one 404.

- [ ] **Step 1: Write the failing tests:** `admitComment` refuses 2001 characters after stripping and the 101st note; comment and thread answer the account gate's `auth-off` dark and 401 armed without a session; armed and signed in, a note appends with the share's current version and the thread returns it byte for byte as plain text; a re-share keeps the notes; revoke deletes them and the tombstone keeps only the count; the forge-import scan is green, and red on a planted import.
- [ ] **Step 2: Run** `cd server && ccrc test -- ./node_modules/.bin/vitest run test/review-comments.test.ts test/auth-gate.test.ts test/box-token-census.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the fields, the decider, the store write and the two doors.
- [ ] **Step 4: Run** them and `test/single-definition`, `test/rings`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(review): signed-in comments, server half (X3 R4.1)`.

### Task R4.2: PWA: notes on the review page and in the owner's list

**Files:**
- Modify: `pwa/src/lib/api.ts` (`reviewThread`, `reviewComment`), `pwa/src/review/main.ts`, `pwa/src/docs/review/ReviewList.tsx`, `ReviewRows.tsx` (the count)
- Test: `pwa/test/docs-review-comments.test.tsx`, `pwa/test/review-page.test.ts`

- [ ] **Step 1: Write the failing tests:** on the review page, a thread answering 401 or the account gate's dark answer shows no notes and no text box, and 200 shows "Notes from reviewers. Not a pull request review.", the notes and a text box; the owner's list shows each share's notes under that heading; a note holding `**x**` and `<b>` renders those characters literally in both places; Page details shows the count.
- [ ] **Step 2: Run** `cd pwa && ccrc test -- ./node_modules/.bin/vitest run test/docs-review-comments.test.tsx test/review-page.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two calls and the three views, notes as text nodes only.
- [ ] **Step 4: Run** them and `test/contrast.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(docs): signed-in comments, PWA half (X3 R4.2)`.

---

## Mutation rows

Each row is measured red and then restored from a saved copy, with the failing count recorded in the run's Results. M-X3.1 to M-X3.16 are the spec's §7 rows; the rest guard this plan's interfaces. Rows are numbered contiguously within each wave, in task order, so no number is skipped: fix round 1 of review 2669 renumbered them after comments moved to R4 and the owner doors to R3 left gaps (F15). Rows a later fix round adds take the next numbers of their wave, so no number is reused.

| Id | File | Mutation | Must red |
|---|---|---|---|
| NDR-X3-R1-M1 | `shared/docsReview.ts` | `REVIEW_MAX_LIVE = 65` | `review-shared` (M-X3.9) |
| NDR-X3-R1-M2 | `review/policy.ts` | the store-bytes check dropped from `admitCreate` | `review-policy` 256 MiB row (M-X3.9, F15) |
| NDR-X3-R1-M3 | `review/routes.ts` | the token grammar checked after the store lookup | `review-routes` grammar-first row (T5, F15) |
| NDR-X3-R1-M4 | `review/routes.ts` | the read door's `bodyLimit` raised to 1 MiB, or its 413 turned into the 404 | `review-routes` 257-byte row (T5, F15, F1's 413) |
| NDR-X3-R1-M5 | `review/store.ts` | `purgeTombstones` keeps tombstones forever | `review-store` purge row (F15) |
| NDR-X3-R1-M6 | `shared/docsReview.ts` | `isReviewSource` checks `head` with its own 40-hex pattern | `review-shared` SHA-256 row (F16) |
| NDR-X3-R1-M7 | `review/policy.ts` | `expiryOf` reads `sharedAt`, not `idleSince` | `review-policy` idle rows: the fixture's `sharedAt` is 3 days before its `idleSince`, so the mutant answers `expired` 3 days early, where the row expects live 1 ms before `idleSince + REVIEW_IDLE_MS` (M-X3.4, N3, N10) |
| NDR-X3-R1-M8 | `review/policy.ts` | pinned skips retention | `review-policy` pinned 30-day row (M-X3.4) |
| NDR-X3-R1-M9 | `review/policy.ts` | `commitVerdict` compares `fp` | `review-policy` blob rows (M-X3.5) |
| NDR-X3-R1-M10 | `review/policy.ts` | another served ref is not `unmeasured` | `review-policy`, `review-sweep` served-ref row (M-X3.5) |
| NDR-X3-R1-M11 | `review/policy.ts` | `unmeasured` answers `committed` | `review-policy`, `review-sweep` (M-X3.5) |
| NDR-X3-R1-M12 | `review/routes.ts` | the marker check moved after the token lookup | `review-routes` marker-less lookup count (M-X3.1) |
| NDR-X3-R1-M13 | `review/routes.ts` | the plugin's error handler removed, so the server's default answers a bad body | `review-routes` oversize and malformed rows (M-X3.1) |
| NDR-X3-R1-M14 | `review/store.ts` | `markViewed` skips the revision re-read | `review-store` revoke-during-read (M-X3.2) |
| NDR-X3-R1-M15 | `review/store.ts` | `remove` takes the entry out of memory last | `review-store` open-while-a-removal-is-held row (M-X3.2, F15) |
| NDR-X3-R1-M16 | `review/store.ts` | `put` writes the index before it renames the bytes | `review-store` crash row, driven by the failing and recording `ReviewFs` (F15) |
| NDR-X3-R1-M17 | `review/store.ts` | boot keeps unreferenced bytes | `review-store` crash row |
| NDR-X3-R1-M18 | `review/store.ts` | the token written into the tombstone | `review-store` |
| NDR-X3-R1-M19 | `review/store.ts` | `put` leaves the superseded version on disk | `review-store` purge row (F6) |
| NDR-X3-R1-M20 | `review/store.ts` | `remove` unlinks the bytes before the index | `review-store` order row (F6) |
| NDR-X3-R1-M21 | `review/store.ts` | no directory `fsync` after the index unlink | `review-store` order row (F6) |
| NDR-X3-R1-M22 | `review/store.ts` | the tombstone written after the index unlink | `review-store` order and interrupted-removal rows (F6) |
| NDR-X3-R1-M23 | `review/store.ts` | boot keeps an index entry whose bytes file is missing | `review-store` lost row (F6) |
| NDR-X3-R1-M24 | `review/store.ts` | `put` keeps the token of an expired, unswept share | `review-store` expiry-is-terminal row (F3) |
| NDR-X3-R1-M25 | `review/store.ts` | `setPinned` skips `expiryOf` | `review-store` expiry-is-terminal row (F3) |
| NDR-X3-R1-M26 | `review/store.ts` | `admitCreate` run before the queue | `review-store` concurrent-create row (F3) |
| NDR-X3-R1-M27 | `review/store.ts` | `setPinned` does not bump `rev` | `review-sweep` pin-race row (F3) |
| NDR-X3-R1-M28 | `review/sweep.ts` | one `tree` call per share, not per ref | `review-sweep` |
| NDR-X3-R1-M29 | `review/sweep.ts` | reads `refs/heads/<branch>` | `review-sweep` served-ref row (M-X3.5) |
| NDR-X3-R1-M30 | `review/routes.ts` | open skips `expiryOf` | `review-routes` read-time expiry row: with the sweep stopped after its start pass and the expired share seeded after that, the mutant serves the share with 200 where the row expects the one 404 (M-X3.3, N10) |
| NDR-X3-R1-M31 | `review/routes.ts` | revoked answers 410 | `review-routes` identical 404 (M-X3.1) |
| NDR-X3-R1-M32 | `review/routes.ts` | drop each of the four headers, one row each | `review-routes` (M-X3.11) |
| NDR-X3-R1-M33 | `review/routes.ts` | the open handler calls the tree reader | `box-token-census` never-read scan (M-X3.6) |
| NDR-X3-R1-M34 | `review/routes.ts` | the per-share limit removed | `review-routes` busy rows (F5) |
| NDR-X3-R1-M35 | `review/routes.ts` | the slot released on `finish` only, not on `close` | `review-routes` abort row (F5) |
| NDR-X3-R1-M36 | `review/routes.ts` | the no-progress timeout removed, or made a total deadline | `review-routes` stalled-reader and slow-reader rows (F5) |
| NDR-X3-R1-M37 | `review/routes.ts` | the bytes sent as one buffer from `readBytes` | `review-routes` streamed row (F5) |
| NDR-X3-R1-M38 | `ccd/ccrc` | `_upd_backup`'s body copies `~/.ccrc` whole | `review-backup` (M-X3.7, F11) |
| NDR-X3-R1-M39 | `deploy/coordination-snapshot.mjs` | its member list gains `review-shares` | `review-backup` (M-X3.7, F11) |
| NDR-X3-R1-M40 | architecture spec | `review/**` dropped from the C9 row | `rings/totality.test.ts` (F10) |
| NDR-X3-R1-M41 | `review/store.ts` | `put` keeps a token that matches a mask shape | `review-store` token re-draw row (A2) |
| NDR-X3-R1-M42 | `review/routes.ts` | the read door answers `text/plain` | `review-routes` mask row: the confirmed credential shape comes back masked (A2) |
| NDR-X3-R1-M43 | `review/store.ts` | `remove` stops at a failed tombstone write | `review-store` failed-tombstone row: the re-opened store serves the share (N2) |
| NDR-X3-R1-M44 | `review/store.ts` | `remove` stops at a failed index unlink | `review-store` failed-index-unlink row: the bytes file stays (N2) |
| NDR-X3-R1-M45 | `review/store.ts` | an all-fail `remove` restores the entry to memory | `review-store` all-fail row: `byToken` answers it (N2) |
| NDR-X3-R1-M46 | `review/store.ts` | `purgeTombstones` ignores a surviving index entry | `review-store` guarded-purge row (N2) |
| NDR-X3-R1-M47 | `review/sweep.ts` | the pass skips `retryPending` | `review-sweep` pending row (N2) |
| NDR-X3-R1-M48 | `review/store.ts` | open skips the writability probe | `review-store` unwritable-directory rows, at mode 0500 and with a `ReviewFs` failing only the probe (mode 000 already fails the directory read, so it cannot red this row) (N2, re-pass m8) |
| NDR-X3-R1-M49 | `review/store.ts` | `markViewed` sets `lastViewedAt` but leaves `idleSince` | `review-store` idle-clock view row (N3) |
| NDR-X3-R1-M50 | `review/store.ts` | unpin leaves `idleSince` | `review-store` idle-clock unpin row (N3) |
| NDR-X3-R1-M51 | `review/store.ts` | a re-share sets `firstSharedAt = now` | `review-store` re-share row: `firstSharedAt` kept (N3, T11) |
| NDR-X3-R1-M52 | `review/store.ts` | `put` ignores a pending removal of its source | `review-store` pending re-share row: two index entries for one source, or the pending token reused (re-pass I1) |
| NDR-X3-R1-M53 | `review/sweep.ts` | no pending-retry timer, or `stop()` skips `retryPending` | `review-sweep` pending rows: the removal waits for a full pass, or survives `stop()` (re-pass I1) |
| NDR-X3-R1-M54 | `review/policy.ts` | `projectList` gives a revoking share its link | `review-policy` revoking row (re-pass m8) |
| NDR-X3-R2-M1 | `review/routes.ts` | drop `X-Frame-Options` or `no-store` from `GET /review`, one row each | `review-routes` page-header rows (F15) |
| NDR-X3-R2-M2 | `src/review/main.ts` | keep the hash | `review-page` (M-X3.10) |
| NDR-X3-R2-M3 | `src/review/main.ts` | post the token on load | `review-page` (M-X3.10) |
| NDR-X3-R2-M4 | `src/review/main.ts` | keep the token in `sessionStorage` for a reload | `review-page` storage row (F4) |
| NDR-X3-R2-M5 | `src/review/main.ts` | `sandbox="allow-scripts"` | `review-page`, browser script row (M-X3.10) |
| NDR-X3-R2-M6 | `review/routes.ts` | `script-src 'self' 'unsafe-inline'` | `review-routes` page CSP row (M-X3.10) |
| NDR-X3-R2-M7 | `vite.config.ts` | drop `review.html` from `globIgnores` | `review-built` precache row, browser installed-PWA row (M-X3.12, N8) |
| NDR-X3-R2-M8 | `sw-denylist.ts` | drop the `/review` entry, or narrow it to `/^\/review(\/|$)/` | `sw-denylist` (M-X3.12), the query row (N5) |
| NDR-X3-R2-M9 | `pwaStatic.ts` | the `allowedPath` filter dropped, or made case-sensitive | `pwa-static-cache` filter rows (M-X3.12, N6, own-2); the `review-routes` spelling rows are characterisation only |
| NDR-X3-R2-M10 | `reader-lab-scans.test.ts` | the review page's allowance widened from `main.ts` to the directory `pwa/src/review/` | `reader-lab-scans` planted control: the iframe in `pwa/src/review/other.ts` must red (F10) |
| NDR-X3-R2-M11 | `review/routes.ts` | `GET /review` built on `reply.sendFile` | `review-routes` page-header row: the answer is the shell or `no-cache`, not the page with `no-store` (N6) |
| NDR-X3-R2-M12 | `src/review/main.ts` | lab mode posts to `/api/review/open` or makes any request | `review-page` lab-mode row (N1) |
| NDR-X3-R2-M13 | `src/review/main.ts` | the script or link line holds while the load marker is unanswered | `review-page` lab-mode positive-signal row (N1, re-pass m2) |
| NDR-X3-R2-M14 | `src/review/labFixture.ts` | a copy's `DOCS_EXPORT_CSP` meta removed from the fixture | `review-lab-fixture`: the fixture no longer equals the builder's bytes (re-pass I3) |
| NDR-X3-R2-M15 | `reader-lab-scans.test.ts` | rule 3's allowance accepts any value in `main.ts` | `reader-lab-scans` planted control: `'allow-scripts'` in `main.ts` must red (re-pass m13) |
| NDR-X3-R3-M1 | `review/routes.ts` | the list accepts any section | `review-routes` bad-query row (F15) |
| NDR-X3-R3-M2 | `review/routes.ts` | pin of an unknown id answers 200 | `review-routes` unknown-share row (F15) |
| NDR-X3-R3-M3 | `review/policy.ts` | `projectList` ignores `armed` | `review-policy`, `review-routes` dark list (M-X3.8) |
| NDR-X3-R3-M4 | `review/routes.ts` | the create handler skips the account gate | `review-routes` dark create (M-X3.8) |
| NDR-X3-R3-M5 | `review/shareForReview.ts` | offered on a committed leaf | `docs-review-share` |
| NDR-X3-R3-M6 | `review/ReviewConfirm.tsx` | upload before the credential check | `docs-review-share` (M-X3.14) |
| NDR-X3-R3-M7 | `review/shareForReview.ts` | scan the document's source text, not the built export | `docs-review-share` stylesheet and SVG rows (M-X3.14, F7) |
| NDR-X3-R3-M8 | `review/shareForReview.ts` | cut every `data:` payload instead of decoding the non-raster ones | `docs-review-share` stylesheet, SVG and font rows (F7) |
| NDR-X3-R3-M9 | `review/shareForReview.ts` | decode raster payloads as text too | `docs-review-share` `tEXt` row: decoded, the chunk's ASCII token counts 1 where the row expects 0 (F7, N10; the base64-coincidence row alone cannot red it, because decoding destroys that shape) |
| NDR-X3-R3-M10 | `review/upload.ts` | re-render the body instead of sending `buildExport`'s bytes | `docs-review-share` SHA row (M-X3.13) |
| NDR-X3-R3-M11 | `export/buildExport.tsx` | `links` filled from the Markdown source, not the built bytes | `docs-export` links row (F8) |
| NDR-X3-R3-M12 | `export/buildExport.tsx` | a Markdown export's `inlined` left empty | `docs-export` new-fields row (F8) |
| NDR-X3-R3-M13 | `review/ReviewRows.tsx` | notice on an equal `fp` | `docs-review-owner` |
| NDR-X3-R3-M14 | `review/ReviewRows.tsx` | Re-share uploads without opening `ReviewConfirm` | `docs-review-owner` re-share hold row (F2) |
| NDR-X3-R3-M15 | `review/routes.ts` | revoke of an already-removed share answers 404 | `review-routes` revoke-after-sweep row (F3) |
| NDR-X3-R3-M16 | `review/store.ts` | `replacedExpired` ignores kept tombstones | `review-routes` create-after-sweep row (F3), on R3.1's wire field (N9) |
| NDR-X3-R3-M17 | `auth/gate.ts` | the create door added to `EXEMPT` | `auth-gate`, `box-token-census` |
| NDR-X3-R3-M18 | `review/shareForReview.ts` | decode one level only, or bound the recursion at 1 | `docs-review-share` nested-payload rows: the @imported sheet's token counts 0 (N4) |
| NDR-X3-R3-M19 | `review/shareForReview.ts` | a payload past the bound counts 0 | `docs-review-share` past-the-bound row (N4) |
| NDR-X3-R3-M20 | `review/ReviewRows.tsx` | the expired-replacement sentence read from `share.version === 1`, not `replacedExpiredOf` | `docs-review-owner` re-share-after-expiry rows: a first share shows the sentence (N9) |
| NDR-X3-R3-M21 | `review/routes.ts` | the create door's `too-large` check measures past `DOCS_EXPORT_MAX_BYTES` (its limit raised by one MiB) | `review-routes` 413 row: a snapshot of `DOCS_EXPORT_MAX_BYTES + 1` bytes is admitted (M-X3.9, a1 (g)) |
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
| DR-5 | last-view TTL | Test box: stop the server, set a share's `idleSince` and `lastViewedAt` 6 days back in its index file, start it; read "Stops working {date}"; open the link and tap Open draft; read the date again. Then stop, set both 7 days back, start | Before the view the date is one day out; after it, seven days from the view (the view moved it, so the clock counts from the last view, not from the share). After the second restart the boot sweep removes it "Expired: no view for 7 days" and the link 404s |
| DR-6 | early removal on same-file branch commit | Commit and push the shared file on its branch; wait one sweep (at most 10 minutes) | "Removed: committed on <branch>"; the link 404s |
| DR-7 | UI Pin/Revoke | Test box: share, Pin; stop the server, set the share's `sharedAt`, `idleSince` and `lastViewedAt` 5 days back in its index file, start it; Unpin; then Revoke, from Page details and from the index list | Each state shows in both places; after Unpin, "Stops working {date}" reads seven days from the unpin (a build counting from the share or the last view reads two days out) |
| DR-8 | retention | Test box: as DR-5, a pinned share with `firstSharedAt` 30 days back | Removed "Removed: 30-day limit" though pinned |
| DR-9 | immediate revoked 404 | Revoke, then at once open the link again from the original message; separately, reload an open review tab | The 404 sentence on the first open after Revoke; the reload shows "To open this draft again, use the link you were sent." |
| DR-10 | unreadability after expiry | After DR-5, DR-6 and DR-8, list the store directory (names only) | No bytes and no index file for those shares; tombstones only, with no token |
| DR-11 | access model vs no-session criterion | First, re-run R2.3's measurement page from the reader lab on the phone's WebKit, on desktop Firefox and on desktop Chromium, as acceptance (the first measurement was the device item before R3). Then open the link signed out, in a private window, on a phone and on a desktop | Each engine renders both fixture copies, the nested mockup frame included, runs no script in them and keeps their links inert; the link opens with no sign-in (the ruled capability model); a guessed or malformed token gives the same 404 |
| DR-12 | never a live working-tree read | Test box: with the agent link down, open a live link | It opens: the read needs nothing from the fleet box. The release's never-read scan (M-X3.6) passes at the release commit |

---

## Deviations found

Three departures, defined by fix round 1 of run 2633 from this wave's issued block on the coordinator's ruling of review finding F14. Each carries out the operator's ruling of 2026-10-25 on #1420 (a frozen snapshot shared for review, required before retirement) and the operator's answers to this wave's asks 595 (a capability link, no session to read) and 603 (signed-in comments only). Each is written into its spec by the wave that ships its behaviour.

- **D-8765 (2026-11-19)** — draft-review-store-and-read-door. Departs from the base spec (`docs/superpowers/specs/2026-10-01-native-docs-reader-design.md`):
  - Goal 1: "**Each install reads its own projects' docs.** That means whatever ccd's projects root holds on that install's fleet box, behind that install's own session gate."
  - Goal 3: "**ccrc never bundles, mirrors or redistributes documents.** The repository is public. Docs stay in the operator's repositories and reach only the operator's signed-in browser. The one way document bytes leave that browser is a file the operator explicitly saves with Export (amended 2026-10-13, §4.17). It is built in the browser from what the page already holds, ccrc stores nothing for it, and Share sends only a GitHub URL."
  - Decision `product`: "A session-gated Docs reader for each install's own project docs. It never bundles docs."
  - Non-goal: "**Share links that ccrc hosts** (amended 2026-10-13). Share sends a GitHub URL only. Expiring links served by ccrc, and Export of a section or directory as a bundle, are deferred (§4.13)."
  - §4.13: "**Expiring share links** (operator, 2026-10-06: later, as their own designed wave with a threat model). Nothing is designed for them."
  - §7.5's README-contents list, its offline-and-auth bullet: "every route is session-gated, never exempt, and uses no box token" (the README's Docs section gains class 9's read door and page, so the bullet stops describing it; added by fix round 2, N12).

  Carries out: the operator's ruling of 2026-10-25 on #1420, and the answers to asks 595 and 603. What changes: the owner may explicitly share a frozen snapshot, which the owner's own server keeps for a bounded time and serves to a capability holder through one exempt read door and its page, outside the session gate. Export of a section or directory as a bundle stays deferred, and Share still sends only a GitHub URL. Lands with R1.
- **D-8766 (2026-11-19)** — draft-review-export-confinement. Departs from the base spec:
  - §4.13, in its "What keeps the option open" bullet: "Share's result is a discriminated union, so a link kind with an expiry can be added as one more arm."
  - M4.EX16: "`buildExport.tsx` exports only `buildExport` and types, and `buildExport` is imported only by `docs/ExportSheet.tsx`, which passes its result's bytes only to `downloadExport`;"
  - §5.4: "`downloadExport(result)` (amended 2026-10-13, W5) is the only consumer of the export builder's output (§4.17), and calls `saveBytes`." (added by fix round 2, N12);
  - §5.6.9, its step 7 (Wrapper): "That arm lives in `docs/export/buildExport.tsx`, whose output reaches only `downloadExport` (M4.EX16, and M5.16 for the file's `<iframe` allowance)." (N12);
  - M5.16's parenthetical: "(the mockup export's wrapper, whose output M4.EX16 confines to `downloadExport`)" (N12).

  Carries out: the operator's ruling of 2026-10-25 on #1420, and the answers to asks 595 and 603, through the coordinator's ruling on review finding F14. What changes: the expiring link is its own action, not a Share arm; Export's builder output gains a second consumer in every sentence that confines it to `downloadExport`; Export's builder gains a second importer (`docs/review/ReviewConfirm.tsx`, by `import()`) and its bytes a second consumer (`docs/review/upload.ts`), each with a planted control; the action spends routes and writes durable state, Share and Export still do neither. Not departed (the coordinator confirmed this reading in round 2): §4.16's "It runs entirely in the PWA. It adds no route, wire field, page key or census entry, and writes no durable state." and the same bullet's "Share and Export spend no page key, route or census entry, and write no durable state." stay true, because Share and Export themselves are unchanged; the new action is neither. Lands with R3.
- **D-8767 (2026-11-19)** — draft-review-page-frame-and-parser. Departs from base M5.16: "`<iframe` and `srcDoc` only in `MockupFrame.tsx` and, amended 2026-10-13, `docs/export/buildExport.tsx`" and "`new DOMParser(` only in `docs/mockup/parse.ts`"; and from the rich-docs spec (`docs/superpowers/specs/2026-10-12-rich-docs-reader-and-shared-renderer-design.md`) A2b: "`<iframe` and `srcDoc` only in `MockupFrame.tsx` and `docs/export/buildExport.tsx`, the mockup export's wrapper, and, outside `pwa/src/docs`, in `pwa/src/readerLab/frames.ts` only", which M8.10 pins "As A2b"; from base M4.EX16's W5 clause: "`<iframe` and `srcDoc` nowhere in `pwa/src` (W6's M5.16 adds its two files)" (re-pass m11); and from the reader lab design (`docs/superpowers/specs/2026-11-03-reader-lab-design.md`), its Before row: "the ten lines, every one "not run", in two groups (E18's eight, E17's two); Start", which gains one anchor to the measurement page (re-pass I2). Carries out: the operator's ruling of 2026-10-25 on #1420, and the answers to asks 595 and 603. What changes: `pwa/src/review/main.ts` gains one allowance for each, an `<iframe sandbox="">` with `srcdoc` and one inert `DOMParser` parse of the copy's bytes for its links list, and `pwa/src/review/labFixture.ts` (M-X3.16's committed fixture, R2.3) one for the nested `<iframe sandbox="" srcDoc>` text of its mockup copy, each with its own planted control. `pwa/src/review/main.ts` may also set the frame's `sandbox` to the empty string (`reader-lab-scans` rule 3, the strictest value), and the reader lab's screen gains the one anchor; its ten lines, probes and result grammar are unchanged. The reader frame's sandbox and the shell's CSP are unchanged. Lands with R2.

## Results (design wave X3, run 2633)

**What was measured and read** (2026-11-18, `main` at `6f5421139`):
- Issue #1420 and its one comment (the operator's 2026-10-25 ruling); #1419 (forge review of a document, for the comments question); #276 (identity, for the access question).
- The ledger's Carried constraints, "Recorded draft decision" and "Retirement drops no feature" in full; the completion plan's Delivery units "Required follow-ons" row, Task 16 steps 1-2, Task 17 and its Required extension acceptance matrix; the completion design's draft rows; the rich-docs §6 rows G11 and "Draft review by link"; the base spec's §0, §4.13, §4.16, §4.17 and §5.6.9.
- Shipped source, by reading and four Sonnet·medium fact-check passes: Share and Export (`share.ts`, `buildExport.tsx`, `exportInput.ts`, `exportMarkdown.tsx`, `provenance.ts`, `policy.ts`); the docs routes and read path (`server/src/docs/*`, `shared/docs.ts`); the auth gate's `EXEMPT` table, its tests and the box-token census; `buildServer`'s static fallback; `vite.config.ts`'s precache and `sw-denylist.ts`; the browser harness `pwa/browser/app.ts`; the backup set in `ccd/ccrc`; `shared/redact.mjs` and `CREDENTIAL_MASKS`; the generated Caddyfile (host plus `reverse_proxy`, no access log).
- The standalone reader's source, for behaviour only: drafts served live, no access control, no snapshot, expiry, revocation or comments.
- One Opus·high adversarial read of the spec and plan: 16 findings (11 important, 5 minor, none critical), every one fixed in this revision. The main ones: the precached page would have been served without its headers; links inside the copy could never work, so they are inert and listed outside; the plan's files would have reddened the docs module's own guards, so the feature is its own module under `/api/review`; store writes acted on stale entries, so every mutation now re-reads by version; early removal read the wrong ref and keyed shares without their section; the idle clock never restarted; the credential check called the redactor wrongly and scanned too little; the fragment's protection was overstated, so the token is posted only after a tap and the residual is stated (T3a); the browser harness could not run the rows, so R2.3 adds a server mode; a shared rate limit let one caller lock every reviewer out, so it is dropped.

**Commands run:** `ccrc-api mail inbox`; `ccrc-api claims take` (claim 5299); `gh issue view 1420|1419|276 -R Synapsium-Labs/ccrc-pwa`; `grep` and `sed` reads of the files above; one `graphify query`. No test was run: the wave changes documents only.

**Fix round 1 (review run 2669 at `7c66cbfb6`, coordinator mail 25509).** One commit per finding, on the coordinator's four rulings:
- F13 `b1c9715f2`: waves reordered, so no release hands out a link before its page exists: R1 server read side, R2 review page, R3 owner create and controls, R4 comments; each spec amendment lands with the wave that ships its behaviour.
- F14 `fb21c1d5b`: "Share a draft for review" is its own action in Page details and Share is unchanged; D-8765, D-8766 and D-8767 defined below, each quoting its sentences.
- F1 `6cd483e63`: the read door has its own plugin, body limit, error handler (the one 404) and marker header, tested on the real `buildServer`; create and comment pass the account gate, the one writer of `auth-off`.
- F3 `019df7aa1`: expiry is terminal; every mutation re-applies expiry and admission inside the queue, with a revision counter for the sweep and pin race.
- F2 `c08e2467e`: re-share runs the same confirm and credential check.
- F4 `90889cbb0`: a reload keeps no token and shows a fixed sentence; DR-3, DR-4 and DR-9 reworded.
- F5 `2157be277`: true streaming, 2 sends a share and 16 in all, released on close; the 60 s send deadline became a 30 s no-progress timeout in the adversarial re-pass.
- F6 `cc2b2eee1`: superseded versions deleted after the commit point; tombstone, then index and directory `fsync`, then bytes; boot finishes interrupted removals and removes `lost` entries.
- F7 `e7c1ca35e`: the credential check scans the built export with non-raster payloads decoded, through `credentialMaskSource`.
- F8 `6becb8039`: `ExportResult` gains `inlined`, `omitted` and `links`.
- F9 `a02e2512e`: the frame-policy claims are gated on measurement row M-X3.16 per engine, WebKit before DR-11.
- F10 `ca025947b`: the ring-context table and the reader-lab scan's iframe allowance, each red first.
- F11 `f5f0b7e85`: M-X3.7 reads every backup site, `_upd_backup` and the coordination snapshot helper included; citation corrected.
- F12 `c57882bc1`: DR-5 measures the clock moving on a view, DR-7 the unpin restart.
- F16 `b4713acb7`: `isReviewSource` reuses the docs grammars, SHA-256 repositories included.
- F15 `563b65f4e`: reworked rows, a row for every guard named, rows renumbered contiguously.
- A0 `1ac372564`: the built page moved outside the static root; the adversarial re-pass `f35c916dc` put it back in `dist-pwa/` behind the static plugin's `allowedPath` filter (spec §3.5), which is where it stays. A2 `5151884a8`: the answer mask (token re-draw, egress inventory, the read door's binary-type dependency pinned). A1 is closed by F13; A3's points are closed by F3, F9 and F11 and by the trailer paragraph on every new commit. The promise-delta fence `69ce5ff70`.

**Adversarial re-pass of fix round 1** (one Opus·high read of the changed sections): F2, F4 (two stale lines aside), F5 to F7, F9 to F12, F14, F16, A1 and A2 confirmed fixed; it found ten new defects, all fixed: the read door's 413 restored as F1 ruled and the built page kept in the release tree behind a static-plugin filter `f35c916dc`; the door contracts carry the store's `expired` and `stale` answers, list, pin and revoke stay off the account gate, and the comment doors state its measured dark answer `83b9993f2`; a mockup's omitted rows carry `not-inlined` `58ddf94e3`; unmeasurable mutation rows moved or reworked and the send deadline made a no-progress timeout `106a8b18c`; stale text, deviation wording and plan hygiene `98adc1245`. It verified every D-8765 to D-8767 quote as an exact substring of its spec, and that DR-1 to DR-12 still map one to one onto Task 17's Draft review row. Still open for the coordinator: whether §4.16 and §4.13's no-route sentence stay out of D-8766 (both remain true of Share and Export themselves).

**Asks:** two, ask 595 (access model) and ask 603 (comments). The coordinator released both to the operator (mails 25240 and 25405), and both came back answered on the structured ask on 2026-11-18. Access model: capability link (the recommendation). Reviewer comments: signed-in comments only (not the recommendation, which was none). Following the coordinator's direction for an adopted comment feature, comments are the follow-on wave R4 with their own threats (spec §3.6, C1-C5), and nothing in R1-R3 depends on them. The finished ask records are no longer listed, so who answered is read from the release mails, not measured.
