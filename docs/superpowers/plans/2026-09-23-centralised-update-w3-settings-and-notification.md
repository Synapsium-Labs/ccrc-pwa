# Centralised update management — programme wave 3: /settings, the update banner, release push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator gets a `/settings` screen that reads W2's control plane — channel, auto-install and release-notification settings, the catalogue line, the release list and the node inventory, with every move control rendered DISABLED — plus an `UpdateBanner` on the fleet screen, a `BuildLine` arrow affix, a red banner when the gate is off on a non-loopback origin, and ONE Web Push per release tag, persisted across restarts, whose tap opens `/settings`.

**Architecture:** Server side, one new store writer (`markReleaseNotified`, the notification writer group W2 already named), one pure L1 decision (`server/src/update/notify.ts`: which tag, on which channel, push or only mark), and one sessionless helper on `FleetWatcher` (`pushRelease`) that runs after every catalogue poll and every inventory sweep on a server-role process: decide → mark `notifiedAt` synchronously → then, iff the decision says push, fire `push.notify` unawaited with an additive `url`. One L0 module (`shared/update-summary.ts`) spells the "fleet and server are on …" clause once for the push body, the banner and nothing else. PWA side, a typed client over W2's four routes (`lib/api.ts`), one polling hook (`fleet/useUpdatesView.ts`, the `useFleetHealth` shape: newest-issued-wins, injected mode, visibility refresh) that FleetScreen polls once and hands down, a new secondary route (`screens/SettingsScreen.tsx`, the `AccountsScreen` skeleton), a new banner (`fleet/UpdateBanner.tsx`, the `FleetHostBanner` idiom), and `BuildLine` + `FleetHostBanner`'s skew names moved together from `FleetHealth.builds` onto `NodeWire[]`. `push-sw.js` forwards `url` into the notification and prefers a same-origin path on tap.

**Tech Stack:** TypeScript on node `>=22.13.0`; server: `node:sqlite` `DatabaseSync` under `tx()`, Fastify 5 (unchanged routes), `web-push` through the existing `PushService`; PWA: React 19 + Vite, vitest + jsdom + `@testing-library/react` (`css: false` — CSS assertions through `test/cssRule.ts` only), the service worker as plain JS loaded into `push-sw.test.ts` by `new Function`; `design/contrast-check.mjs` for new colour rules. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-centralised-update-management-design.md` — §13 in full (with the four move controls DISABLED); §12's unarmed-non-loopback red banner; §14 first bullet (the `FleetHealth.builds` readers move); §15 row W3; §18 rows "`bundleListed` is never "verified"", "notes are capped and plain" (the plain renderer), "unreachable is not current", "the move controls are disabled in W3", "one push per tag, across restarts", "`notify` gates the push", "the push lands on settings", and W2's "one writer per column group" (extended to the notification group).

**Producer:** W2 — `docs/superpowers/plans/2026-09-22-centralised-update-w2-control-plane.md` (committed at `1288beec`). W2 MERGES BEFORE this wave is dispatched; every task below assumes W2's code is on `main` and spells every W2 name exactly as that plan does. Anchors into files W2 does not touch are at `d759c914`; anchors into files W2 changes are by QUOTED W2 text, never by line.

**Out of scope, said once:** the `apply`/`rollback` routes and every control that would call them (they render disabled; programme wave 5 enables them); the dispatcher, the agent `update` op, any edit to `ccd/ccrc` or `ccd/ccd`; the PWA bundle's own update (`pwa/src/main.tsx`, spec §13's last paragraph); a theme control (spec §17); a new `NotifyEvent` kind (the release push is not a feed record); retiring `FleetHealth.builds` from the wire (spec §14: it stays, unread by the PWA after Task 12).

## Global Constraints

- **W2 names are spelled as W2's plan spells them**: `UpdatesView`, `NodeWire`, `ReleaseWire`, `UpdateIntentWire`, `CatalogueState`, `UpdateRouteRefusal`, `UpdateRouteError`, `IntentWriteAnswer`, `AckAnswer`, `FLEET_SCOPE`, `UPDATE_STORE_REFUSE_CODES`/`isUpdateStoreRefuseCode`, `ReleaseRow`, `NodeRow`, `UpdateIntentRow`, `releases()`, `nodes()`, `intentFor()`, `eligibleTags`, `EligibilityRow`, `UPDATE_RING_FILES`, `WRITER_GROUPS`, `W2_WRITERS`, `CataloguePoller`, `sweepThenProject`, `inventoryNow()` — one spelling per name across this plan.
- **L0 `shared/*.ts` imports nothing at runtime**; `shared/update-summary.ts` (Task 3) imports nothing at all; `shared/api.ts` gains no import line. Every W3 addition to `shared/api.ts` is APPENDED inside W2's end-of-file update block, below every line `README.md:2560` and `session-hook.test.ts`'s citation audit cite (D-3188) — the two refusal words and their two docstring entries (Task 1, in place in the one array) and `UPDATE_GATE_CAP` (Task 7, after the file's last line) only.
- **L1 is `server/src/update/notify.ts`**: pure, imports only `'../../../shared/*.js'` and `'./resolve.js'` (itself L1), no `fs`, no store, no push; every file under `server/src/update/` imports shared modules at three levels (`'../../../shared/<x>.js'`, W2 ruling R7) and joins `UPDATE_RING_FILES`.
- **`coord.db` stays synchronous**: `markReleaseNotified` has a ONE-LINE signature with a return type (`mail-hardening.test.ts`'s `SIG`), puts its guard in the `WHERE` (`notifiedAt IS NULL`), writes `notifiedAt` ONLY, and returns a result union, never `void`.
- **At most once per tag, across restarts**: the mark COMMITS before the send is started; the send is `void`ed and never retried (D-3295); no in-memory latch stands in for `releases.notifiedAt` (`mergedNotified`'s `Set`, `watch.ts:441`, is the anti-pattern).
- **The release push never goes through `pushOne`** (`watch.ts:1425-1499`) and never through `NotifyLog`/`recordFeedEvent`; `NOTIFY_KINDS`/`NotifyEvent` are untouched (D-3296).
- **The notifier runs on a server-role process only**: `cfg.role === 'server' || cfg.role === 'both'` (W2 Task 9's `role`), the gate `resolveAndProject` uses; its notify mode is read from `intentFor(FLEET_SCOPE)` alone, never a per-node row.
- **No move control is enabled in this wave**: Install, Roll back (release list), Update, Roll back (node row) and Update all render `disabled` beside the ONE literal `MOVE_DISABLED_TEXT = 'lands with the next release (W4)'` (Task 5); a Darwin inventory row renders no Update or Roll back at all (D-3308), and a Darwin node draws no arrow on any surface — `pendingTag` answers null for it, so the banner's Update all is never offered on its account (D-3309); `pwa/src/lib/api.ts` spells neither `/api/updates/apply` nor `/api/updates/rollback`. Ack is enabled (its route is W2's).
- **Wire discipline**: `PushPayload.url` is optional and additive; `FLEET_PROTO`/`FLEET_PROTO_MIN` stay 1; `FleetHealth` is unchanged and `FleetHealth.builds` stays on the wire; one reader per field.
- **Unreachable is not current**, at all three surfaces (settings, banner, BuildLine): nothing renders "up to date" or a "checked" line while `catalogue.lastOkAt` is null; no node renders an arrow while its `measuredAt` or `channel` is null, or while its stamp was not READ (`stampRead !== 'ok'`, the guard Task 9 adds, D-3307) — the ONE arrow predicate is `pendingTag` (Task 5, amended by Task 9), read by Tasks 9, 11 and 12; an unreachable node's row says so (`reachabilityLine`, Task 9) rather than reading as current.
- **Tag order is semver, never string order**: every comparison of two tags goes through `shared/semver.ts`'s `compareReleaseTags`/`isNewerTag` after `isReleaseTag` (both throw `RangeError` on a non-tag); `v0.0.10` is newer than `v0.0.9`.
- **Untrusted text renders as text**: release notes, labels, `resolveDetail`, `report.detail` and `refused[]` reach the DOM only as React text children; no `dangerouslySetInnerHTML`, no markdown, no link detection anywhere in `pwa/src/screens/SettingsScreen.tsx` or `pwa/src/fleet/UpdateBanner.tsx`.
- **PWA wire reads are defensive**: every array read guards `Array.isArray`; every boolean is checked `=== true`; state from a poll is set with a functional `setState`; a malformed `/api/updates` answer is a failure, never an empty fleet (`asUpdatesView`, Task 5).
- **No hand-kept duplicate of a W2 vocabulary in `pwa/src`**: option lists come from `UPDATE_CHANNELS`/`AUTO_MODES`/`NOTIFY_MODES`, labels are `Record<UpdateChannel|AutoMode|NotifyMode, string>`, the scope is `FLEET_SCOPE`, the gate word is `UPDATE_GATE_CAP` (moved to L0 by Task 7) — `single-definition.test.ts` walks `pwa/src`.
- **PWA suites run from `pwa/`**: `cd pwa && ./node_modules/.bin/vitest run test/<file>.test.tsx` (foreground; `npm ci` first where `node_modules` is absent); `npm run build` (`tsc --noEmit && vite build`) is the type gate — there is no lint. Server suites: `cd server && ./node_modules/.bin/vitest run test/<file>.test.ts`. Never bare `npx vitest`.
- **Every screen test reproduces the full `afterEach`** (`accounts-screen.test.tsx:46-51`): `cleanup(); vi.restoreAllMocks(); navigate('/'); act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));`.
- **CSS**: new classes are appended to `pwa/src/fleet/fleet.css` after its last line; no bare `repeat(n, 1fr)` (`fleet-css.test.ts:1188-1208`); every new rule that sets `color` over an unpainted ancestor is registered in `pwa/design/audit.mjs`'s `INHERITED_GROUNDS` (`:520`, entries inserted before its closing `};`, `:746` at `d759c914`) with `under` + `why`, and `node design/contrast-check.mjs` is green before the commit. An unregistered colour rule does NOT land silently: it enters the uncovered census, which D-2689 froze (`GRANDFATHERED_UNCOVERED`, `contrast.test.ts:119`), and reds `contrast.test.ts`'s "contains no identities beyond the grandfathered blind spots" (`:1160-1166`); a self-grounded rule (its own `background` and `color`) needs no entry. Every task that adds CSS records the gate's `ALL <n> PASS` / uncovered count before and after (255 uncovered at `d759c914`, unchanged by this wave).
- **Cited files move no cited line**: `shared/api.ts` (above `:7526`), `single-definition.test.ts` (`:32-37`, `:1274`, `:1303`, census 8) and README's anchors — every edit is line-neutral above them or appended after them, each task says which, and that task's green run includes `server/test/session-hook.test.ts` Task 13's new README paragraph is the one README edit that adds lines: it carries no `file:line` or `:<digits>` token (the audit's `REF_RE` makes the file part optional, so even a clock time is a citation), W2's "Not yet" lines are replaced line-for-line, and the README size claim (`pools-prose.test.ts`, `oss-metadata.test.ts`) is re-measured in that commit.
- **No residue in tracked text**: no hostname, username, absolute home path, docserver URL or the org name; `server/test/topology-clean.test.ts` runs before every commit that adds a file.
- **Deviation numbers are issued by the allocator** (`POST /api/ledger/deviations`) and defined in the same act. This plan's departures carry the numbers the coordinator minted for run 130 on 2026-09-23 (the section below). A departure found while executing takes the next unspent number of the run's RESERVE block, named in the wave brief; it is defined in `## Deviations found` in the same commit that first cites it, and an unspent reserve number is never written as a `D-` token anywhere (`deviation-refs.test.ts`). Never a concrete `D-TBD-` spelling (`dtbd.test.ts`).
- **Mutation-table discipline**: every guard ships with a test that goes red when the guard is removed or mutated, measured before/after; each task names the §18 rows it pins.
- **Tests use fixture HOMEs only** (`mkTmp`/`removeTmpFixtures`); never the live `$HOME`, a live `coord.db` or a real push service.
- **Commit on the workspace branch only** — at least one commit per task, `feat(update): …` / `test(update): …`.

## Review Focus

Input classes and failure modes the spec implies but no §18 row exercises, most likely first:

1. **The notifier races itself.** A catalogue poll's continuation and an inventory sweep can both call `pushRelease` inside one tick, and a restarted process (a new `FleetWatcher` over the same `coord.db`) can call it before the first sweep completes; "once per tag" holds only if decide-and-mark is one synchronous step and the second caller reads the committed `notifiedAt`. **Task 3** adds "two `pushRelease` calls back to back send once", "a new watcher over the same db sends nothing", and Task 1's "a second mark of the same tag answers `already-notified` and leaves the first `notifiedAt`".
2. **Deciding before anything is measured.** After a fresh install or a wiped `coord.db`, the catalogue can answer before the first inventory sweep writes a node row; a rule of "push iff some node is older" then reads an empty fleet as "nobody is older" and marks the newest tag with no push, losing it for good. **Task 2** adds the zero-measured-nodes case (no decision, nothing marked — D-3300) and the placeholder-row case (`measuredAt: null` counts as unmeasured, not as unversioned).
3. **String order where semver order is meant.** `v0.0.10` sorts below `v0.0.9` as a string; the release list, the Install/Roll back direction, the banner's pick of the tag and the arrow predicate each compare tags. **Task 8** adds a `v0.0.10` above `v0.0.9` list-order case and a direction case across that boundary; **Task 11** adds the banner picking `v0.0.10`; **Task 5** adds `pendingTag` across the boundary.
4. **An absent, refused or malformed `/api/updates` answer.** A 501 `not-configured`, a stub `{}`, a `nodes` that is not an array, or a poll that fails after a good one must neither crash a screen, nor clear the last good view, nor render an empty fleet as "nothing to update". **Task 5** adds `asUpdatesView` over each malformed shape (including `catalogue: {}`, whose `lastOkAt` is `undefined` and so `!== null`) and the hook's keep-last-view case; **Task 7** adds the `not-configured` rendering, a first-read-failed sentence and a stale note above the last good view; **Task 10** keeps the banner and the Notifications section on screen whatever `/api/updates` answers; **Task 11** adds "a failed poll after a newer-release poll keeps the banner".
5. **Same-user-writable text reaching the DOM, and a push `url` that is not ours.** Notes, labels, `resolveDetail` and `report.detail` are strings a same-user writer controls, and a push payload's `url` is honoured by the service worker with no origin check today. **Task 8** adds notes carrying `<img src=x onerror=…>`, `<b>` and a `javascript:` URL rendered literally plus a source scan that `SettingsScreen.tsx` spells no `dangerouslySetInnerHTML` (**Task 11** carries the same scan over `UpdateBanner.tsx`, which does not exist at Task 8); **Task 9** adds a label and a `report.detail` with markup; **Task 4** adds absolute, protocol-relative (`//host/x`), backslash (`/\host`), tab-escaped (`/\t/host` — the URL parser strips the tab, so a prefix check admits it) and `javascript:` urls falling back to today's target, and `/.//host` honoured only AS WRITTEN (the parser's normalised pathname would be protocol-relative).

## Deviations found

Plan-level departures from the spec's literal text, each carrying the number the allocator issued for it (run 130, minted 2026-09-23). The first six were fixed by the coordinator while decomposing the wave; the rest were found while writing the task interfaces and bodies, and each says which task found it.

- **D-3294** — Spec §13 says `notify` "decides which tags push" and that the push is once per tag, but not what happens to a tag every live node already runs. The first deploy of this wave meets exactly that: every catalogue row has `notifiedAt = NULL` (W2 never writes the column), the newest eligible tag is the one the fleet was just rolled to, and a literal "push the newest unnotified tag" would announce a release the operator installed an hour ago. `releaseToNotify` (Task 2) therefore returns `push: false` when every live, measured node's `currentVersion` is a tag at or above the candidate, and `pushRelease` (Task 3) marks that tag notified without sending; it returns `push: true` when some measured node's `currentVersion` is NULL, not a tag, or older. Pinned by Task 2's "a current fleet: marked, not pushed" case and Task 3's "a current fleet sends nothing but marks" (`sent` empty, `notifiedAt` set, a newer tag listed afterwards pushes). Cost if wrong: an operator whose fleet was updated by hand before the catalogue saw the tag never gets a push for it — which is the push they did not need.
- **D-3295** — Spec §13 says `releases.notifiedAt` is "written in the same transaction as the send decision", but the send is `PushService.notify` (`push.ts:68-87`), an async network fan-out, and `tx()` (`db.ts:245`) forbids an `await` inside its callback by construction. The decision and the mark are one synchronous step (`markReleaseNotified`, whose `WHERE notifiedAt IS NULL` makes a second marker lose), and the send is started only after the mark committed, `void`ed, and never retried: a failed or partial send (a dead endpoint, no network) is NOT re-attempted on the next sweep. At-most-once is chosen over at-least-once because a repeated "vX is out" push is exactly the noise the persisted dedup exists to stop, and a missed one is recovered by the banner and the settings screen within one poll. Pinned by Task 3's "the mark is committed before notify is called" (a `push.notify` double that reads `releases()` on a SECOND connection to the same `coord.db` inside the call sees `notifiedAt` set; mutation M6 moves the mark after the send and reds it) and "a send that rejects is not retried" (a rejecting double, a second sweep, one call). Cost if wrong: a release whose one push failed is announced only in the PWA.
- **D-3296** — Spec §13 says the release push "bypasses the presence gate … by design", citing `pushOne` (`watch.ts:1425-1502`) as the shape it departs from, but `pushOne`'s parameter requires `sessionId: string`, gates on `this.deps.presence?.isVisible(e.sessionId)` unconditionally (`:1458`), records a `NotifyEvent` whose closed `kind` union has no release member, and always threads `sessionId` into the payload. The release push is its own sessionless helper, `FleetWatcher.pushRelease` (Task 3), which calls `this.deps.push?.notify(...)` directly with no `sessionId`, no presence check and no feed record — `pushOne`, `NotifyLog` and `NOTIFY_KINDS` are untouched. Pinned by Task 3's "a visible session does not suppress the release push" (a `Presence` with a claimed session, the push still sent) and "the release push leaves no feed row" (`coord.feedEvents(10)` empty, and no ring record), and by the payload assertion that its keys are exactly `body, tag, title, url` (no `sessionId`, no `actions`); mutation M4 (the send routed through `pushOne`) reds them. Cost if wrong: none; a release push is not about a session.
- **D-3297** — Spec §13 says the auto-install choice is "disabled with the node list when any node lacks `update-gate`" without saying who computes it; the authority is W2's route (`POST /api/updates/intent` → `409 auto-needs-rollback-gate {nodes}` from `autoGateBlockers`). The DISABLED state is computed in the PWA from `NodeWire.caps` (`autoGateMissing`, Task 7) so the control is disabled before a tap rather than after a refusal, and the server's `409` stays the authority: when it answers (a node lost the word between the poll and the tap), the screen renders the refusal's `nodes` — node IDS, per W2's `autoGateBlockers` — mapped to labels through `view.nodes` (an id no row carries is shown as the id; a 409 naming no string id falls back to the route's toast sentence). Pinned by Task 7's "auto is disabled and names every node without the gate word" and "a 409 auto-needs-rollback-gate renders the node labels". Cost if wrong: for up to one poll the control's state can disagree with the route, and the route wins.
- **D-3298** — Spec §12 says the settings screen shows the unarmed-exposure sentence "when `/health` reports the gate off and the request's origin is not loopback", but `GET /health` (`server.ts:1073-1076`) answers only `{ok, build, version?}` and reports no gate state; the gate's configuration is `AuthStatus.mode` (`shared/api.ts:6527-6530`) on the unauthenticated `GET /api/auth/status` (`server.ts:1032`), read by `readAuthStatus` (`pwa/src/lib/auth.ts:192`). Task 10 reads that route instead of widening `/health`, and shows the banner iff `mode === 'off'` exactly (an absent `mode`, an older server's silence or a failed read shows nothing) AND `location.hostname` is not in `LOOPBACK_HOSTS` (`shared/base-url.ts:51`). Pinned by Task 10's four quadrants (off + non-loopback → banner; off + `127.0.0.1` → none; `passphrase` + non-loopback → none; a rejecting status read — a `404` or a network failure — → none), an absent `mode` → none, one status read per mount and no `/health` read; the loopback set is `LOOPBACK_HOSTS` itself, whose re-spelling in `pwa/src` reds `single-definition.test.ts`'s existing `BASE_URL_OK is declared in exactly one file…` case. Cost if wrong: none to the wire; one more anonymous GET per settings mount.
- **D-3299** — Spec §13 asks for "two radio rows" for the channel and a choice among three for auto-install and release notifications, and the PWA has no radio primitive (`pwa/src` has no Toggle/Switch/RadioGroup; the two selection idioms are `NotificationBell`'s single `aria-pressed` button and `MailScreen`'s `role="group"` + `aria-pressed` filter chips, `MailScreen.tsx:203-223`, which are toggles, the wrong semantics for one-of-N). The three selectors are native `<fieldset>` + `<legend>` + `<input type="radio" name=…>` rows inside a `<label>`, so the platform supplies the radio group's roles, arrow-key movement and checked state. Pinned by Tasks 7 and 10's `getByRole('radio', { name })` / `toBeChecked()` cases and the tap-floor rule on `.settings-option` (`min-height: var(--tap-min)`). Cost if wrong: a third selection idiom in the tree.
- **D-3300** — Found writing Task 2's interface. The coordinator's rule marks a tag when no live measured node is older, which on a fleet with ZERO measured nodes (a fresh `coord.db`, or a catalogue answer landing before the first inventory sweep after W2's migration) is vacuously true, so the newest tag would be marked with no push and never announced. `releaseToNotify` returns `null` — no decision, nothing marked — when no row of `nodes()` has `measuredAt !== null`; a label placeholder written by `markUnreachable` (`measuredAt: null`) counts as unmeasured, never as unversioned. The next sweep, which measures, decides. Pinned by Task 2's "no measured node: no decision" and "a placeholder row is not an unversioned node". Cost if wrong: the first release after a fresh install is announced one sweep late.
- **D-3301** — Found writing Task 3's interface. Spec §13 spells the same clause in two places — the banner's "fleet and server are on v0.0.7" and (by the coordinator's copy) the push body's "On stable — fleet and server are on v0.0.7" — and the two are written by two packages (`server/`, `pwa/`), which would make two hand-kept copies of one sentence. It is declared once, in a new L0 module `shared/update-summary.ts` (`versionSides`, `sideVersion`, `versionsSummary`), importing nothing and typed structurally so neither side's row type leaks into L0; `notify.ts`'s copy (Task 3) and `UpdateBanner` (Task 11) import it, and `BuildLine`/`FleetHostBanner` (Task 12) take their side-picking from `versionSides` through `remoteSides` (D-3313). Two rules of the module go beyond the coordinator's wording ("when they agree"), and the spec says nothing about either: the one-clause form needs both sides to carry the SAME TAG, so two unversioned sides render `fleet unversioned · server unversioned`, never "fleet and server are on unversioned" (a sameness nothing measured); and `versionSides`' fleet side falls back to the server row when that row's role is `both` (local mode's one box), a fallback W2 Task 14's `derivedBuilds` does not have (it answers `fleet: null` there) and is not given. Pinned by `server/test/update-summary.test.ts` (both forms, a missing side, an unversioned side, "two unversioned sides never agree", local mode's one `both` row; mutations M12 and M13) and a `single-definition.test.ts` case that `'fleet and server are on '` has one holder across the four TS roots (M14) — comments count, so no other file under `shared`, `server/src`, `pwa/src` or `agent/src` may spell the clause even in a comment. Cost if wrong: one more file in `shared/`.
- **D-3302** — Found writing Task 5's interface. The PWA's error translators compose as `xErrorText(apiErrorText(err))` (`useAttachImage.ts`, `kickoffErrorText`), so a code `API_ERROR_TEXT` owns reaches the second translator as a sentence — and `API_ERROR_TEXT['not-configured']` is the kickoff sentence "This box does not run coordination — there is no mail store to queue a kickoff into." (`api.ts:212`), which is false on the update surface, while `bad-request` is owned by two other tables already. `updateErrorText(err)` therefore reads `err.body.error` FIRST against `UPDATE_ERROR_TEXT` (keyed `Exclude<UpdateRouteError, 'unauthenticated'>`, so a word W2 adds is a compile error here) and falls back to `apiErrorText(err)` only for a code it does not own; it consumes no other translator's output and no translator consumes its output, so the mutual-exclusion suite's composition hazard (`api.test.ts:704-778`) does not arise. Pinned by Task 5's "not-configured on an update route is the update sentence, not the kickoff one" and "every UpdateRouteError but unauthenticated has a sentence" (a `satisfies Record<…>` compile check plus a runtime key census), and by the five existing translators (`sendErrorText`, `submitErrorText`, `uploadErrorText`, `apiErrorText`, `kickoffErrorText`) returning every update-only code unchanged. Cost if wrong: none; a sixth code table in `lib/api.ts` with a different composition, said so at the table.
- **D-3303** — Found writing Task 6. Spec §13 puts a labelled gear door in `.fleet-head-right`, but `fleet.css`'s own Chromium-measured note above `.fleet-runs-line` (pinned in `fleet-css.test.ts` and `fleet-class-chooser.test.tsx`) says the group's four steady-state items need 244px of the 294px available at a 390px viewport, leaving ~38px once a fifth item's 12px gap is paid. The labelled door (glyph, `Settings` in 11px mono, padding) needs ~80px — ESTIMATED from the tokens, not measured in a browser (there is none on the box that wrote this) — and even a glyph-only door at the 44px tap floor would not fit; unchanged, the head would push the fleet screen past the viewport on a phone, the horizontal-overflow defect #116 shipped. Task 6 therefore appends ONE override, `.fleet-head > .fleet-head-right { flex-wrap: wrap; justify-content: flex-end; row-gap: 0; }`, which out-specifies `.fleet-head-right` (0,2,0 against 0,1,0) so it wins from any position in the sheet: the right group breaks onto a second right-aligned line only where it does not fit, and nothing moves where it does. Pinned by Task 6's head-wrap `cssRule` scrape in `settings-screen.test.tsx` (mutation: delete `flex-wrap: wrap;` → red); the real layout measurement is the coordinator's phone check after rollout. Cost if wrong: a two-line header on narrow phones instead of an overflowing one.
- **D-3304** — Found writing Task 6. `.accounts-door`, the pattern the new door copies, is deliberately left in the contrast audit's uncovered census because its ground is two — the page on a phone, `.shell-nav`'s `--bg-surface` in the desktop sidebar (`contrast.test.ts:1803-1819` pins that choice; `fleet.css:2342-2362` argues it). The census is now frozen (D-2689, `GRANDFATHERED_UNCOVERED`), so a new identity cannot copy that choice: left unregistered, Task 6's CSS takes the census from 255 to 260 and reds "contains no identities beyond the grandfathered blind spots". `.settings-door` and `.settings-door:active` (with the shell's `.settings-back`, `.settings-back:active` and `.settings-title`) are registered in `INHERITED_GROUNDS` on `var(--bg-page)`, following the `.pool-epoch-lag` entry in the same header (endorsed by review round C2, `contrast.test.ts:136-146`), and a new `contrast.test.ts` describe measures each door rule's own declared ink on `--bg-surface` in both themes (measured on a copy of `pwa/` at `d759c914`: 8.67 / 7.41 and 15.68 / 16.58), so both grounds carry a number though the registry names one. `.accounts-door` is unchanged (pre-existing debt). Pinned by that describe and by the census case (mutation: delete the `.settings-door` entry → red, census 255 → 256). Cost if wrong: none to the product; a sidebar ground retinted below 4.5:1 reds the new describe.
- **D-3305** — Found writing Task 7's interface. W2 declares `UPDATE_GATE_CAP = 'update-gate'` in `server/src/update/resolve.ts` (L1, server-only), which the PWA cannot import, and D-3297 needs the same word in `pwa/src`, where a second literal would be a hand-kept copy `single-definition.test.ts` exists to refuse. Task 7 moves the declaration into W2's end-of-file block of `shared/api.ts` (appended, D-3188) and `resolve.ts` imports it and re-exports it (`export { UPDATE_GATE_CAP }`), so every W2 importer (`update/routes.ts`, `update-resolve.test.ts`) keeps its import path. Pinned by an appended `single-definition.test.ts` case — `'update-gate'` is spelled once across the four TS roots, in `shared/api.ts` — and by W2's `update-resolve.test.ts` staying green. Cost if wrong: none; one declaration moves.
- **D-3306** — Found writing Task 7's interface. Spec §13 spells the three catalogue renderings as `checked 4 min ago` / `couldn't reach GitHub since 14:02 — rate limited` / `never checked`. Three wordings change. (1) The duration is `elapsedWords` (`pwa/src/lib/elapsed.ts`), the tree's one spelling of a span, whose own header forbids a second d/h/m ladder — so it reads `checked 4m ago` (and `checked moments ago` under a minute, and for a `lastOkAt` in the viewer's future). (2) W2 keeps only the LATEST failure (`lastError.at`, D-3197), so "since" cannot name when the outage began: with `lastOkAt` set the amber line reads `couldn't reach GitHub since <clock time of lastOkAt> — <reason>` (true: not reached since then), and with `lastOkAt` null — a restarted server that has never reached GitHub — it reads `couldn't reach GitHub (tried <clock time of lastError.at>) — <reason>`, never a "since" it cannot measure. (3) Both amber clocks are `dayClock` — bare `14:02` on the viewer's own local day, `14:02 · 22 Sep` off it (the dated shape `lib/clock.ts`'s `resetClock` already prints) — because `lastOkAt` freezes at the last success while a failure may recur for days, and a bare `since 14:02` after a day-long or cross-midnight outage reads as today's and shrinks it. Pinned by Task 7's catalogue cases and its `dayClock` case. Cost if wrong: the amber and calm lines differ from the spec's example in wording, not in which state they render.
- **D-3307** — Found writing Task 9. Spec §13/§18 say no arrow while `measuredAt` or `channel` is null, and §13's Pins add that "a node with `stampRead: 'unreadable'` renders amber and no arrow". Task 5's predicate cannot keep that pin: W2's `toNodeWire` sets `current` to null for a stamp that was not read (`buildInfoOfRow`), so `nodeVersion` is null exactly as for an unversioned build, and W2's resolver still resolves such a node (`floorOf(highestVersion, null)`), so `desiredTag` and `channel` are set and "a null `nodeVersion` points up" would draw `→ vX`. Task 9 puts the rule in the ONE arrow predicate — `pendingTag` gains `if (n.stampRead !== 'ok') return null;` — so all three surfaces (inventory, banner, BuildLine) inherit it rather than disagree: any `stampRead` other than `ok` (`unreadable`, `malformed`, `absent`, or the field missing) is an UNMEASURED current, never an unversioned one, and draws no arrow; a stamp that was read and carries no tag still points at its desired tag. Every Task 5 case stays green (its fixtures carry `stampRead: 'ok'`). Pinned by `use-updates-view.test.tsx`'s "pendingTag — a stamp that was not READ draws no arrow" and the settings case "an unreadable stamp renders amber and no arrow"; deleting the guard reds both. Cost if wrong: a node whose stamp the sweep cannot read shows no pending update on the banner, BuildLine or inventory until its stamp reads again.
- **D-3308** — Found writing Task 9. Spec §13 lists Update / Roll back / Ack on every inventory row and says a Darwin row reads `macOS: not centrally managed` in place of its desired; decision 17 says macOS nodes are not centrally managed in this programme. A disabled Update or Roll back on a Darwin row, captioned `lands with the next release (W4)`, would promise a move no wave delivers, so a Darwin row renders NO Update or Roll back and no move note; Ack stays, gated by `canAck` like every row. Pinned by Task 9's Darwin rendering case (the macOS sentence, no desired, no Update/Roll back, an Ack); the `const darwin = false;` mutation reds it. Cost if wrong: a Darwin row shows two fewer disabled buttons than a Linux row.
- **D-3309** — Found reviewing Task 11; lands in Task 9. Spec §13 says a Darwin inventory row reads `macOS: not centrally managed` in place of its desired, and says nothing about the banner or BuildLine for such a node; W2's resolver resolves a Darwin node like any other (`os` plays no part in §9's resolution), so its `channel`/`desiredTag` can be set. With the Darwin clause only in the inventory row, a macOS server one tag behind would raise the banner with "Update all" and draw `server v0.0.9 → v0.0.10` on BuildLine, while "See what's new" opened a row saying the node is not managed — three surfaces disagreeing about one node. The rule goes in the ONE arrow predicate: `pendingTag` gains `if (n.os === 'darwin') return null;` directly after its read-stamp guard, and `NodeItem` reads `pendingTag(n)` with no Darwin clause of its own (it keeps the macOS sentence and drops Update / Roll back, D-3308). Only a MEASURED `darwin` is excluded; `os: 'unknown'` keeps its arrow. The release push (Tasks 2–3) is untouched: it compares the nodes' `currentVersion`, not `pendingTag`, so a macOS-only fleet still hears that a release is out. Pinned by `use-updates-view.test.tsx`'s "pendingTag — a macOS node draws no arrow" (with its `linux`/`unknown` control), Task 11's "is silent when the only node behind is a macOS node" and Task 12's "draws no arrow on a macOS node"; deleting the guard reds all three (Task 9 mutation 13, Task 11 mutation 8, Task 12 M13). Cost if wrong: a fleet whose only behind node is macOS shows no banner and no BuildLine arrow — the push and the release list still say the release exists.
- **D-3310** — Found reviewing Task 9. The wave's decomposition (item 9) enables Ack when `update.state ∈ {failed, reverted}` or a request is outstanding or the node has refusals, with no condition on the lease; spec §13 lists Ack on every row and names no enablement. W2's `ackNode` (W2 Task 5, D-3183) acks only a row whose `updateState` is in `SETTLED_UPDATE_STATES` and answers `busy` for `pending`, `applying` and `unknown`, so the unconditioned rule would show an ENABLED Ack on every in-flight update (once W4 writes requests) whose every tap is the busy toast. `canAck` (Task 9) returns false unless `update.state` is in W2's imported `SETTLED_UPDATE_STATES`, then applies the three clauses unchanged; the route stays the authority for the poll-to-tap race. Pinned by Task 9's `canAck` helper case (busy states with a request or a refusal → false) and its rendering case (a `pending` row's Ack disabled, the same request on an `idle` row enabled); mutation: delete the settled guard → both red. Cost if wrong: a wedged `unknown` row shows no Ack until W4's deadline turns it `failed`, the cost D-3183 already accepts.
- **D-3311** — Found writing Task 10. Spec §13 lists the release-notifications choice (*on my channel / stable only / off*) in the Notifications section with no condition, but the choice is a write to `update_intent['*'].notify`, which a box without a coordination database does not have. The fieldset therefore renders only once `/api/updates` has answered with a view; while the read is pending, or when it answers `501 not-configured`, the section shows the reused `NotificationBell` (or `This browser cannot receive Web Push.`) and no release radios — never three radios that would each answer the same refusal. The unarmed-exposure banner does not depend on the update view either, and neither section is lost to an early return (Task 7's loading and `not-configured` states stay inside the Updates section). Pinned by Task 10's "renders the section while /api/updates is pending and on a box with no control plane — with no release radios" (mutation 8 reds it). Cost if wrong: an operator on a box with no coordination database has no release-notification control — and such a box sends no release push anyway.
- **D-3312** — Found writing Task 12's interface. Spec §14 says W3 "moves `FleetHostBanner`'s skewed arm … onto `NodeWire[]`", but the arm's TRIGGER is `health.build === 'skewed'`, the `BuildAgreement` word computed by `buildAgreement` (`server/src/fleetstate.ts:208-215`, sha + dirty), which W2 Task 14 already derives from the inventory rows server-side and which no L0 module exports — recomputing it in the PWA would be a second copy of the agreement rule. The trigger stays `health.build`; what moves onto `NodeWire[]` is the VERSION CLAUSE the arm names (today read off `health.builds`), taken from `remoteSides(nodes)` (Task 12's wrapper over Task 3's `versionSides`, D-3313) — so `FleetHealth.builds` has no PWA reader after Task 12, as §14 requires. Pinned by Task 12's "warns when the boxes run DIFFERENT builds, naming both nodes' versions from the inventory …", "the trigger is still the server's agreement word — disagreeing rows under an agreed health are silent", the decoy cases (a health answer carrying a disagreeing `builds` pair is never what renders), the fleet-screen case "both readers name the inventory's versions, never the health route's pair", and the literal-absence scan that no file under `pwa/src` spells `.builds`. Cost if wrong: the trigger (15 s poll) and the names (60 s poll) can lag each other by one poll — the names then say what the inventory last measured.
- **D-3313** — Found writing Task 12. Task 3's `versionSides` falls back to the server row for the fleet side when that row's role is `both` — right for local mode, where one box is both, and relied on by the push body and the banner. But `BuildLine` and `FleetHostBanner`'s skew arm render only on a REMOTE fleet, where W2's `derivedBuilds` (which feeds `health.build`, the skew trigger) reads a `both` row as the server side only, with `fleet: null`. Unguarded, a remote server recorded as `both` with no fleet row yet would render "fleet v0.0.7 · server v0.0.7" — a fleet version nobody measured, beside a trigger computed without one. A new export, `remoteSides(nodes)` in `pwa/src/fleet/BuildLine.tsx`, is `versionSides` with one rule added — a fleet side that IS the server row comes back null (it renders `fleet —`) — and `FleetHostBanner.tsx` imports it, so the two readers cannot disagree about which row is the fleet box. Pinned by BuildLine's "on a remote fleet, a server row recorded as both is this box — never the fleet box" and the banner's "names no fleet version off a server row recorded as both — on a remote fleet that row is this box"; mutation M6 (return `versionSides` unchanged) reds both. Cost if wrong: a remote `both` server shows `—` for the fleet side until the fleet row is measured.
- **D-3314** — Found reviewing Task 3. The wave's decomposition (item 3) runs the release decision "after every catalogue poll AND every inventory sweep", and both lanes fire unawaited on a new process's first tick (W2's D-3198: the first tick polls and sweeps at once). A poll that resolves before this process's first sweep would decide on the `nodes` rows the PREVIOUS process wrote. After a server-box update those rows still carry the version the update replaced, so the decision would push "vX is out" to a fleet already on vX, which is the first-deploy noise D-3294 exists to prevent. The catalogue side (`tick()`'s catalogue gate and `POST /api/updates/refresh`) therefore goes through `pushReleaseAfterPoll`, which answers `skipped/not-yet-swept` until `sweepThenProject` has finished once in this process. That run's own call makes the first decision, on rows it has just measured. Pinned by the push-copy case "the catalogue lane waits for this process's first inventory run", and by M17 (the gate deleted) and M18 (the flag never set). Cost if wrong: a release listed in the first seconds after a restart is announced up to one inventory beat (60 s) later than its poll.

## File structure

**New**
- `server/src/update/notify.ts` — L1. The release notifier's pure decision (`releaseToNotify`) and its copy (`releasePushCopy`, `releasePushTag`, `RELEASE_PUSH_URL`); imports `'../../../shared/*.js'` and `'./resolve.js'` only.
- `shared/update-summary.ts` — L0. The "fleet and server are on …" clause and the side picker (`versionSides`, `sideVersion`, `versionsSummary`); imports nothing.
- `pwa/src/fleet/useUpdatesView.ts` — the `/api/updates` poll (`useUpdatesView`), its wire guard (`asUpdatesView`) and the one arrow predicate (`pendingTag`, `nodeVersion`); Task 9 adds `pendingTag`'s read-stamp guard.
- `pwa/src/screens/SettingsScreen.tsx` — the `/settings` screen: Updates (channel, auto, check now, catalogue line, release list, node inventory) and Notifications (the bell, release notifications, the unarmed banner).
- `pwa/src/fleet/UpdateBanner.tsx` — the fleet screen's "vX is out" banner.
- `server/test/update-store-notified.test.ts` — `markReleaseNotified`'s cases.
- `server/test/update-notify.test.ts` — `releaseToNotify`'s table and the copy.
- `server/test/update-summary.test.ts` — the L0 summary.
- `pwa/test/use-updates-view.test.tsx` — the hook and its guard (Task 5); the read-stamp describe (Task 9).
- `pwa/test/settings-screen.test.tsx` — every settings pin.
- `pwa/test/update-banner.test.tsx` — the banner pins.

**Changed**
- `server/src/coord/store.ts` — L3. `MarkReleaseNotifiedResult` and `markReleaseNotified`, in W2 Task 4's `// ── update catalogue ──` section (after `refusalsFor`, before the private `nodeRowExists`), and that section's banner comment.
- `shared/api.ts` — L0. Two words appended to `UPDATE_STORE_REFUSE_CODES` and two entries to its docstring (Task 1); `UPDATE_GATE_CAP` appended after the file's last line (Task 7).
- `server/src/update/resolve.ts` — L1. `UPDATE_GATE_CAP` imported from `shared/api.ts` and re-exported instead of declared (Task 7).
- `server/src/push.ts` — L3. `PushPayload.url?: string`.
- `server/src/watch.ts` — L4. `ReleasePushOutcome`, public `pushRelease(now)`, the private `lastReleasePushFailure`, its imports (`FLEET_SCOPE` and `type MarkReleaseNotifiedResult` in place; two new lines), and its two call sites (the catalogue poll's continuation in `tick()`, the end of `sweepThenProject`).
- `pwa/public/push-sw.js` — `PATH_BASE` and `sameOriginPath` (the URL parser decides); the `push` listener forwards `url` into `data`; `notificationclick` prefers a same-origin path, answered as written.
- `pwa/src/lib/api.ts` — `updates`, `setUpdateIntent`, `refreshUpdates`, `ackUpdateNode`, `UpdateIntentRequest`, `UPDATE_ERROR_TEXT`/`updateErrorText`, `MOVE_DISABLED_TEXT`.
- `pwa/src/app.tsx` — the `/settings` boolean, the `data-view` chain, the `.shell-detail` rung, the import.
- `pwa/src/screens/FleetScreen.tsx` — the gear door; one `useUpdatesView()` poll handed to `UpdateBanner`, `FleetHostBanner` and `BuildLine`.
- `pwa/src/fleet/BuildLine.tsx`, `pwa/src/fleet/FleetHostBanner.tsx` — onto `NodeWire[]` together through `BuildLine.tsx`'s new `remoteSides` (Task 12); `FleetHostBanner.tsx`'s `BuildInfo` import deleted.
- `pwa/src/fleet/fleet.css` — `.settings-*`, `.update-banner*`, `.build-line-next`, and the `.fleet-head > .fleet-head-right` wrap override (Task 6), appended.
- `pwa/design/audit.mjs` — `INHERITED_GROUNDS` entries for the new colour rules whose selector names no painted ancestor: five (Task 6), four (Task 7), three (Task 8), two (Task 9), one (Task 12); Tasks 10 and 11 add only self-grounded or colourless rules.
- `server/test/update-writer-groups.test.ts` — `W3_WRITERS` and the floor over both lists.
- `server/test/single-definition.test.ts` — `'notify.ts'` in `UPDATE_RING_FILES` (one line replaced in place, Task 2); two appended one-holder describes (the summary clause, Task 3; the gate word, Task 7).
- `server/test/push-copy.test.ts` — imports edited in place, the `watcher()` factory replaced (`cfg?`, `catalogue?`, `home?`; returns `w`), an appended describe for the release push.
- `server/test/update-notify.test.ts` — Task 2's file; the copy cases appended by Task 3.
- `pwa/test/push-sw.test.ts`, `pwa/test/api.test.ts`, `pwa/test/app.test.tsx`, `pwa/test/fleet-screen.test.tsx` (Tasks 6, 11, 12), `pwa/test/contrast.test.ts` (Task 6), `pwa/test/build-line.test.tsx` (rewritten whole), `pwa/test/fleet-host-banner.test.tsx` — the per-task pins.
- `README.md` — W2's "Control plane" paragraph's "Not yet" lines corrected (line-neutral) and one new paragraph: the Settings screen, the banner, release notifications (Task 13); `CLAUDE.md` only if a rule changes (at most its README size claim).

## Tasks

### Task 1: Store — the notification group

**Files:**
- Modify: `server/src/coord/store.ts` — `MarkReleaseNotifiedResult` directly after W2 Task 4's `ClearRefusalsResult` (quoted: `export type ClearRefusalsResult =` … `  | { ok: false; why: 'unknown-node' };`) and before W2 Task 4's `/** The columns \`releases()\` reads, as SQLite hands them back. */ interface RawReleaseRow`; the method directly after W2 Task 4's `refusalsFor(nodeId: string): RefusalRow[]` (its closing `  }`) and before the docstring of W2 Task 4's private `nodeRowExists` (`/** Any \`nodes\` row with this id, superseded included — the read a`), which is the last member of the `// ── update catalogue ──` section *(correction: the skeleton said "directly after `refusalsFor` … before W2 Task 5's `// ── update inventory ──` banner"; `nodeRowExists` sits between the two, so "after `refusalsFor`" is the anchor and the private helper stays last)*; and the section's banner comment, whose sentence "`notifiedAt` is W3's `markReleaseNotified`, and nothing here names it." becomes false the moment the method lands in that section — its two lines are replaced by three *(correction: not in the skeleton)*. `store.ts` is cited by no document in the session-hook audit's corpus (W2 Task 4, measured at `d759c914`: `grep -no 'store\.ts:[0-9]'` over `README.md`, the compaction-card spec and its plan-a prints nothing), so none of these inserts need be line-neutral.
- Modify: `shared/api.ts` — two words appended to `UPDATE_STORE_REFUSE_CODES` after W2 Task 6's `'journal-unreadable', 'journal-unwritable',` and two entries appended to that array's docstring after W2 Task 6's last entry (`journal-unwritable — … rolled back.`); the array lives in W2's END-OF-FILE update block, below every cited line (D-3188, W2 ruling R5) — no line above `:8138` moves.
- Modify: `server/test/update-writer-groups.test.ts` — `const W3_WRITERS = ['markReleaseNotified'] as const;` (with its docstring) directly after W2's `W2_WRITERS` declaration; the floor case `it('finds every W2 writer writing — …')` iterates `[...W2_WRITERS, ...W3_WRITERS]` and its title says "every W2 and W3 writer". `WRITER_GROUPS`' notification row (`{ table: 'releases', group: 'notification', columns: ['notifiedAt'], writers: ['markReleaseNotified'] }`) is W2's and is NOT edited.
- Test: `server/test/update-store-notified.test.ts` (create)
- Run, not modified: `server/test/mail-routes.test.ts` (the coord kebab-token scan admits the two new words through W2 Task 4's one `|| isUpdateStoreRefuseCode(tok)`), `server/test/mail-hardening.test.ts` (`SIG`), `server/test/single-definition.test.ts` (the SQL-tuple scans over `store.ts`), `server/test/session-hook.test.ts` (R13: `shared/api.ts` is cited), W2's `server/test/update-store-catalogue.test.ts` ("never touches notifiedAt — the notifier's column (W3) survives a re-listing"), W2's `server/test/update-store-intent.test.ts` (its "a word is declared twice" uniqueness check reads the same array), `server/test/typecheck-tests.test.ts`, `server/test/topology-clean.test.ts` (a new file).

**Interfaces:**
- Consumes: `tx` (`db.ts:245`, `BEGIN IMMEDIATE`); `isReleaseTag` (W2 Task 1; already in `store.ts`'s `'../../../shared/api.js'` import block since W2 Task 4's `  isReleaseTag, isUpdateChannel,` line — no import edit here); the `releases` table's `notifiedAt INTEGER` column (W2 Task 3, `-- notification columns: writer = the notifier (W3), method markReleaseNotified`); `ReleaseRow.notifiedAt: number | null`, `releases()`, `applyReleaseListing` and `ReleaseListingRow` (W2 Task 4); `UPDATE_STORE_REFUSE_CODES`/`UpdateStoreRefuseCode`/`isUpdateStoreRefuseCode` (W2 Tasks 4–6, ruling R5 — appended to, never a second vocabulary); `WRITER_GROUPS`, `W2_WRITERS`, the analyser (`scan`, `violations`) in `update-writer-groups.test.ts` (W2 Task 7); `openCoordDb` (`db.ts:114`), `mkTmp` (`tmpHelpers.ts:38`).
- Produces (in `store.ts`):

```ts
export type MarkReleaseNotifiedResult =
  | { ok: true; notifiedAt: number }
  | { ok: false; why: 'bad-tag'; tag: string }                        // tag fails isReleaseTag — decided before any SQL
  | { ok: false; why: 'unknown-release'; tag: string }                // no releases row carries the tag
  | { ok: false; why: 'already-notified'; notifiedAt: number };       // the WHERE's guard held: the stored value, unchanged

// CoordStore — ONE-LINE signature; writes releases.notifiedAt and nothing else.
// THROWS RangeError when `at` is not a non-negative safe integer (a caller bug — the compareReleaseTags stance)
markReleaseNotified(tag: string, at: number): MarkReleaseNotifiedResult
```

- The write is `UPDATE releases SET notifiedAt = ? WHERE tag = ? AND notifiedAt IS NULL` inside `tx()`; on `changes === 0` the method reads the row back AFTER the write, inside the same `IMMEDIATE` transaction (W2's "the `why` of a zero-change write is read back after the write"), to tell `unknown-release` from `already-notified`. It never un-marks: there is no writer that sets `notifiedAt = NULL`.
- *(Correction, not in the skeleton — the `at` guard.)* Measured with node's `node:sqlite` (`DatabaseSync`, node 24): `prepare('UPDATE r SET n = ? WHERE tag = ? AND n IS NULL').run(NaN, 'a')` answers `{ changes: 1 }` and leaves `n` NULL — SQLite binds NaN as NULL. Unguarded, a NaN `at` would answer `{ok: true}` while the tag stays unmarked, and the next sweep would push it again: the one failure this writer exists to prevent. `at` is the caller's clock (`Date.now()` / the sweep's `now` in Task 3), so a non-integer or negative value is a caller bug and throws `RangeError` before any SQL — not a refusal arm, so no vocabulary word — and Task 3's `pushRelease` already turns a throw from any store call into `{did: 'failed'}`.
- Produces (in `shared/api.ts`, appended to the one array — ruling R5):

```ts
export const UPDATE_STORE_REFUSE_CODES = [
  /* W2 Task 4's five, Task 5's four, Task 6's six, then: */ 'unknown-release', 'already-notified',
] as const;
```

- Produces (in `update-writer-groups.test.ts`): `const W3_WRITERS = ['markReleaseNotified'] as const;` — the floor now also requires the scan to FIND `markReleaseNotified` writing `releases`.
- Spec §18 rows pinned: "one push per tag, across restarts" (the store half: the guard in the `WHERE`, so a second mark is refused and a restarted process reads the committed value); W2's "one writer per column group" (the notification group now has its writer, and a `notifiedAt` write planted in `applyReleaseListing` reds the group scan; a catalogue column planted in `markReleaseNotified` reds it).

This task's red-then-green was measured on a scratch tree assembled from `d759c914`'s `tx`, W2 Task 3's `MIGRATIONS[13]` DDL and W2 Task 4's and Task 7's code blocks verbatim, plus the code below: Step 2's reds, Step 6's greens and every row of Step 7's table behaved as written there. The real tree's counts differ (it carries Tasks 5–6); the case NAMES and messages do not.

- [ ] **Step 1: Write the failing tests**

Create `server/test/update-store-notified.test.ts`:

```ts
// Design 2026-09-20 §6/§13 (W3 Task 1) — `releases.notifiedAt`, the
// notification group's ONE writer (`markReleaseNotified`). The dedup that makes
// a release push "once per tag, across restarts" is this column, persisted —
// never an in-memory latch (`mergedNotified`'s `Set`, watch.ts, forgets on
// restart by its own comment). Store-level only: no notifier, no push, no
// clock — every `at` is a literal so each case reads as the rule it pins.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  UPDATE_STORE_REFUSE_CODES, isUpdateStoreRefuseCode, type UpdateStoreRefuseCode,
} from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type MarkReleaseNotifiedResult, type ReleaseListingRow } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';

const T0 = 1_790_000_000_000;

const dbFile = (): string => path.join(mkTmp('update-store-notified-'), 'coord.db');
const fresh = (): CoordStore => new CoordStore(openCoordDb(dbFile()));

const url = (tag: string): string => `https://example.invalid/download/${tag}/ccrc-${tag}.tar.gz`;
/** One listing element in the shape the poller hands `applyReleaseListing` (W2 Task 4). */
const rel = (tag: string, publishedAt: number, over: Partial<ReleaseListingRow> = {}): ReleaseListingRow => ({
  tag, channel: 'stable', publishedAt, commitSha: null, tarballUrl: url(tag),
  bundleListed: true, notes: null, draft: false, ...over,
});
/** The catalogue written by its own writer, so every row is one the notifier will really meet. */
const listed = (store: CoordStore, rows: readonly ReleaseListingRow[]): CoordStore => {
  expect(store.applyReleaseListing(rows, T0, 'complete').ok).toBe(true);
  return store;
};
const notifiedOf = (store: CoordStore, tag: string): number | null | undefined =>
  store.releases().find((r) => r.tag === tag)?.notifiedAt;

// The refusal words live in the ONE update-store vocabulary (W2 ruling R5:
// `UPDATE_STORE_REFUSE_CODES`, appended to — never a second array). Held equal
// to the result's arms BOTH ways at compile time (`typecheck-tests.test.ts`),
// asserted below so the lines are read.
type MarkWhy = Extract<MarkReleaseNotifiedResult, { ok: false }>['why'];
const MARK_WHYS = ['bad-tag', 'unknown-release', 'already-notified'] as const satisfies readonly MarkWhy[];
const everyWhyListed: [Exclude<MarkWhy, (typeof MARK_WHYS)[number]>] extends [never] ? true : never = true;
const everyWhyDeclared: [Exclude<MarkWhy, UpdateStoreRefuseCode>] extends [never] ? true : never = true;

describe('markReleaseNotified — the notification group\'s one writer (design 2026-09-20 §13)', () => {
  it('marks an unnotified release and answers the value it wrote; the other rows stay unmarked', () => {
    const store = listed(fresh(), [rel('v0.0.10', T0 + 2), rel('v0.0.9', T0 + 1)]);
    expect(store.markReleaseNotified('v0.0.10', T0 + 10)).toEqual({ ok: true, notifiedAt: T0 + 10 });
    expect(notifiedOf(store, 'v0.0.10')).toBe(T0 + 10);
    expect(notifiedOf(store, 'v0.0.9')).toBeNull();
  });

  it('a second mark of the same tag answers already-notified with the FIRST value and writes nothing (§18 "one push per tag")', () => {
    const store = listed(fresh(), [rel('v0.0.9', T0)]);
    expect(store.markReleaseNotified('v0.0.9', T0 + 10).ok).toBe(true);
    expect(store.markReleaseNotified('v0.0.9', T0 + 20))
      .toEqual({ ok: false, why: 'already-notified', notifiedAt: T0 + 10 });
    expect(notifiedOf(store, 'v0.0.9')).toBe(T0 + 10);
  });

  it('a restarted process reads the committed mark — a new store over the same coord.db is refused (§18 "across restarts")', () => {
    const file = dbFile();
    const before = listed(new CoordStore(openCoordDb(file)), [rel('v0.0.9', T0)]);
    expect(before.markReleaseNotified('v0.0.9', T0 + 10).ok).toBe(true);
    before.db.close();
    const after = new CoordStore(openCoordDb(file));
    expect(after.releases()[0]).toMatchObject({ tag: 'v0.0.9', notifiedAt: T0 + 10 });
    expect(after.markReleaseNotified('v0.0.9', T0 + 99))
      .toEqual({ ok: false, why: 'already-notified', notifiedAt: T0 + 10 });
  });

  it('a tag no catalogue row carries is unknown-release, and nothing is written', () => {
    const store = listed(fresh(), [rel('v0.0.9', T0)]);
    expect(store.markReleaseNotified('v0.0.10', T0 + 10)).toEqual({ ok: false, why: 'unknown-release', tag: 'v0.0.10' });
    expect(fresh().markReleaseNotified('v0.0.9', T0 + 10)).toEqual({ ok: false, why: 'unknown-release', tag: 'v0.0.9' });
    expect(notifiedOf(store, 'v0.0.9')).toBeNull();
  });

  it('a malformed tag is bad-tag — decided before any SQL, so never mistaken for an unknown release', () => {
    const store = listed(fresh(), [rel('v0.0.9', T0)]);
    for (const tag of ['0.0.9', 'v0.0', 'v0.0.9\n', '']) {
      expect(store.markReleaseNotified(tag, T0 + 10), JSON.stringify(tag)).toEqual({ ok: false, why: 'bad-tag', tag });
    }
    expect(notifiedOf(store, 'v0.0.9')).toBeNull();
  });

  it('an `at` that is not a non-negative integer throws, and marks nothing — SQLite would bind NaN as NULL', () => {
    const store = listed(fresh(), [rel('v0.0.9', T0)]);
    for (const at of [Number.NaN, 1.5, -1, Number.POSITIVE_INFINITY]) {
      expect(() => store.markReleaseNotified('v0.0.9', at), String(at)).toThrow(RangeError);
    }
    expect(notifiedOf(store, 'v0.0.9')).toBeNull();
    // …and the tag is still markable afterwards: nothing half-wrote it.
    expect(store.markReleaseNotified('v0.0.9', T0 + 10)).toEqual({ ok: true, notifiedAt: T0 + 10 });
  });

  it('writes notifiedAt ONLY — every catalogue column, the yank mark and the refusal roll-up are as the listing left them', () => {
    // A draft is stored yanked = 1: a mark that also "cleaned" the yank would show here.
    const store = listed(fresh(), [rel('v0.0.10', T0 + 2, { draft: true, notes: 'n', channel: 'dev' }), rel('v0.0.9', T0 + 1)]);
    const before = store.releases();
    expect(store.markReleaseNotified('v0.0.10', T0 + 10).ok).toBe(true);
    expect(store.releases()).toEqual(before.map((r) => (r.tag === 'v0.0.10' ? { ...r, notifiedAt: T0 + 10 } : r)));
    expect(store.releases()[0]).toMatchObject({ tag: 'v0.0.10', yanked: true, observedAt: T0 });
  });

  it('a later listing of the same tag keeps the mark — the catalogue writer never names the column', () => {
    const store = listed(fresh(), [rel('v0.0.9', T0)]);
    expect(store.markReleaseNotified('v0.0.9', T0 + 10).ok).toBe(true);
    expect(store.applyReleaseListing([rel('v0.0.9', T0, { notes: 'edited' })], T0 + 20, 'complete').ok).toBe(true);
    expect(store.releases()[0]).toMatchObject({ notes: 'edited', observedAt: T0 + 20, notifiedAt: T0 + 10 });
  });

  it('its refusal words are declared, once each, in the ONE update-store vocabulary (W2 ruling R5)', () => {
    expect([everyWhyListed, everyWhyDeclared]).toEqual([true, true]);
    for (const c of MARK_WHYS) expect(isUpdateStoreRefuseCode(c), c).toBe(true);
    expect(new Set(UPDATE_STORE_REFUSE_CODES).size, 'a word is declared twice').toBe(UPDATE_STORE_REFUSE_CODES.length);
  });
});
```

In `server/test/update-writer-groups.test.ts`, directly after W2's declaration

```ts
const W2_WRITERS = ['applyReleaseListing', 'refuseRelease', 'clearRefusals', 'upsertNodeMeasurement', 'markUnreachable',
  'rekeyNode', 'releaseLease', 'settleNode', 'resolveNode', 'ackNode', 'setIntent'] as const;
```

add

```ts
/** The W3 writers the same floor requires (programme wave 3, Task 1): the
 *  notification group's writer — named in `WRITER_GROUPS` by W2, written by
 *  W3. A list of its own rather than an edit to W2's, so each floor entry
 *  says which wave put it there. Programme wave 5 (spec W4's dispatcher)
 *  appends `dispatchNode`/`requestNode` the same way. */
const W3_WRITERS = ['markReleaseNotified'] as const;
```

and replace the floor case's first three lines

```ts
  it('finds every W2 writer writing — a renamed table or a rewritten call shape reds this, not disarms it', () => {
    const found = new Set(stmts.map((s) => s.method));
    for (const w of W2_WRITERS) {
```

with

```ts
  it('finds every W2 and W3 writer writing — a renamed table or a rewritten call shape reds this, not disarms it', () => {
    const found = new Set(stmts.map((s) => s.method));
    for (const w of [...W2_WRITERS, ...W3_WRITERS]) {
```

(the case's body below those lines — the two `expect`s — is unchanged).

- [ ] **Step 2: Run them to verify they fail, and record the audit's baseline**

Run, from `server/`, one at a time, foreground (timeout ≥ 600000 ms):
- `./node_modules/.bin/vitest run test/update-store-notified.test.ts` — Expected: FAIL, 9 of 9. Eight cases fail with `TypeError: store.markReleaseNotified is not a function` (the `at` case reports it as `NaN: expected error to be instance of RangeError`); "its refusal words are declared …" fails at `unknown-release: expected false to be true`.
- `./node_modules/.bin/vitest run test/update-writer-groups.test.ts` — Expected: FAIL, exactly one case: "finds every W2 and W3 writer writing …" with `the scan found no statement of markReleaseNotified writing an update table: expected false to be true`. (Its first `expect` — `markReleaseNotified is in no writer group` — passes: W2 named the writer in the notification row.)
- `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` — Expected: PASS. Write down its `Tests` line (W2 measured `13 passed | 320 skipped (333)` on its own tree); Step 6 must print the same line.

- [ ] **Step 3: Implement the writer in `server/src/coord/store.ts`**

Directly after W2 Task 4's

```ts
export type ClearRefusalsResult =
  | { ok: true; cleared: number }
  | { ok: false; why: 'unknown-node' };
```

add (a blank line first):

```ts

/** Design 2026-09-20 §13 (W3). `markReleaseNotified`'s answers. `bad-tag` is
 *  decided before any SQL. `already-notified` carries the value that STANDS —
 *  the first marker's, which this call did not change — so a caller that lost
 *  the race knows when the tag was announced; `unknown-release` means no
 *  catalogue row carries the tag. Both are read back after the zero-change
 *  write, inside its transaction. The C2 warning `setAccountPools` carries
 *  applies: the type system will NOT stop a caller discarding this value, so
 *  bind it and discriminate `.ok` before anything is sent. */
export type MarkReleaseNotifiedResult =
  | { ok: true; notifiedAt: number }
  | { ok: false; why: 'bad-tag'; tag: string }
  | { ok: false; why: 'unknown-release'; tag: string }
  | { ok: false; why: 'already-notified'; notifiedAt: number };
```

In W2 Task 4's `// ── update catalogue (design 2026-09-20 §6, §7; W2) ──` banner comment, replace the two lines

```ts
  // on the group. `notifiedAt` is W3's `markReleaseNotified`, and nothing here
  // names it. A node's verdict on a release is a `node_release_refusals` row,
```

with

```ts
  // on the group. `notifiedAt` is the notification group's, and only
  // `markReleaseNotified` (W3, the last public method of this section) names
  // it. A node's verdict on a release is a `node_release_refusals` row,
```

Directly after W2 Task 4's

```ts
  refusalsFor(nodeId: string): RefusalRow[] {
    return this.db.prepare(
      'SELECT nodeId, tag, at, detail FROM node_release_refusals WHERE nodeId = ? ORDER BY at, tag',
    ).all(nodeId) as unknown as RefusalRow[];
  }
```

and before `nodeRowExists`'s docstring, add (a blank line first):

```ts

  /** The notification group's ONE writer (design 2026-09-20 §6, §13; W3).
   *  Stamps `notifiedAt` on one catalogue row, ONCE: the guard is the
   *  statement's own `WHERE … AND notifiedAt IS NULL`, so a second marker —
   *  the other lane in the same tick, or a restarted process over the same
   *  `coord.db` — changes nothing and is told the value that stands. The
   *  caller (`FleetWatcher.pushRelease`) starts a send only after this
   *  returns ok, which is what makes the release push at-most-once per tag
   *  (D-3295). Writes `notifiedAt` and nothing else,
   *  and no method sets it back to NULL. `at` is a caller's clock: a value
   *  that is not a non-negative safe integer throws, because SQLite binds
   *  NaN as NULL — the row would stay unmarked while this answered ok, and
   *  the next sweep would push the tag again. */
  markReleaseNotified(tag: string, at: number): MarkReleaseNotifiedResult {
    if (!Number.isSafeInteger(at) || at < 0) {
      throw new RangeError(`markReleaseNotified: at must be a non-negative integer ms timestamp, got ${String(at)}`);
    }
    if (!isReleaseTag(tag)) return { ok: false, why: 'bad-tag', tag };
    return tx(this.db, (): MarkReleaseNotifiedResult => {
      const res = this.db.prepare('UPDATE releases SET notifiedAt = ? WHERE tag = ? AND notifiedAt IS NULL')
        .run(at, tag);
      if (Number(res.changes) > 0) return { ok: true, notifiedAt: at };
      // The `why` of a zero-change write, read back after it in the same
      // IMMEDIATE transaction: a row that exists failed the IS NULL guard, so
      // its notifiedAt is the first marker's, never NULL.
      const row = this.db.prepare('SELECT notifiedAt FROM releases WHERE tag = ?')
        .get(tag) as { notifiedAt: number } | undefined;
      return row === undefined
        ? { ok: false, why: 'unknown-release', tag }
        : { ok: false, why: 'already-notified', notifiedAt: row.notifiedAt };
    });
  }
```

Three scanners read this text, and each is satisfied by construction: the signature is ONE line with a return type (`mail-hardening.test.ts`'s and `update-writer-groups.test.ts`'s `SIG`, `/^ {2}(?:private |public |static |readonly )*([A-Za-z_$][\w$]*)\(.*\)\s*:\s*(.+?)\s*\{\s*$/`); the write is inside a `this.db.prepare(` window with its column list spelled literally (`setColumns` reads `notifiedAt` and nothing else); and every kebab word in prose is in backticks, so the only single-quoted kebab tokens `mail-routes.test.ts`'s scan finds are the three arms' `why` values.

- [ ] **Step 4: Run the store test and the group scan, and watch the vocabulary case and the kebab scanner go red**

Run, from `server/`, one at a time, foreground:
- `./node_modules/.bin/vitest run test/update-store-notified.test.ts` — Expected: FAIL, exactly one case: "its refusal words are declared, once each, in the ONE update-store vocabulary (W2 ruling R5)", at `unknown-release: expected false to be true`. The other eight PASS: the writer is complete, its words are not yet declared.
- `./node_modules/.bin/vitest run test/update-writer-groups.test.ts` — Expected: PASS, 14 cases (W2's count: the floor now finds `markReleaseNotified`; "every column a statement writes is owned by a group its method writes" reads its `UPDATE releases SET notifiedAt = ?` as the notification group's).
- `./node_modules/.bin/vitest run test/mail-routes.test.ts -t 'every quoted kebab token'` — Expected: FAIL, `unknown-release is not a declared MailRejectCode, RunRefuseCode, LifecycleGapReason, ClaimRefuseCode, SessionLifecycle, ReclaimRefuseCode, AskRefuseCode, RunRouteRefuseCode, SetAccountPoolsRefuseCode or UpdateStoreRefuseCode` (W2 Task 4's message tail). `MarkReleaseNotifiedResult`'s `'unknown-release'` is the first undeclared single-quoted kebab token the scan (`sources()` joins `server/src/coord/*.ts` in `readdirSync` order) reaches; `'bad-tag'` before it is W2 Task 4's word. This red is the measurement that the scanner sees the new arms; Step 5 fixes it and touches no test file.

- [ ] **Step 5: Append the two words to the ONE update-store vocabulary in `shared/api.ts`** (W2 ruling R5, D-3192)

Both edits are in place inside W2's end-of-file update block — below every line `session-hook.test.ts`'s citation audit and README cite (`:7465-7467`, `:7505`, `:7513`, `:7526`), so no cited line moves (ruling R13, D-3188). No new declaration, and `mail-routes.test.ts` is NOT edited: W2 Task 4's one `|| isUpdateStoreRefuseCode(tok)` admits a member added later, which is why the scanner carries a guard rather than an allowlist.

In the array's docstring, replace W2 Task 6's last entry's closing line

```ts
 *                    rolled back. */
```

(the line after ` *    journal-unwritable — \`UpdateIntentLog.append()\` threw; the transaction`) with

```ts
 *                    rolled back.
 *    unknown-release — `markReleaseNotified` (W3): no catalogue row carries
 *                    the tag; nothing is written.
 *    already-notified — `markReleaseNotified` (W3): the tag's `notifiedAt` is
 *                    already set. The first mark stands, and the caller
 *                    sends nothing (design §13: one push per tag). */
```

and W2 Task 6's array

```ts
export const UPDATE_STORE_REFUSE_CODES = [
  'bad-tag', 'duplicate-tag', 'bad-row', 'empty-listing', 'unknown-node',
  'bad-node-id', 'label-key-taken', 'not-busy', 'stale-report',
  'empty-patch', 'bad-field', 'unknown-scope', 'no-channel', 'journal-unreadable', 'journal-unwritable',
] as const;
```

with

```ts
export const UPDATE_STORE_REFUSE_CODES = [
  'bad-tag', 'duplicate-tag', 'bad-row', 'empty-listing', 'unknown-node',
  'bad-node-id', 'label-key-taken', 'not-busy', 'stale-report',
  'empty-patch', 'bad-field', 'unknown-scope', 'no-channel', 'journal-unreadable', 'journal-unwritable',
  'unknown-release', 'already-notified',
] as const;
```

(`bad-tag` is W2 Task 4's word, reused — not appended a second time; the uniqueness checks in this task's test and in W2's `update-store-intent.test.ts` would red on a duplicate.)

- [ ] **Step 6: Run green**

Run, from `server/`, one at a time, foreground (timeout ≥ 600000 ms):
- `./node_modules/.bin/vitest run test/update-store-notified.test.ts` — PASS, 9 cases.
- `./node_modules/.bin/vitest run test/update-writer-groups.test.ts` — PASS, 14 cases.
- `./node_modules/.bin/vitest run test/mail-routes.test.ts` — PASS, the whole file (the kebab scanner admits the two words through W2 Task 4's guard).
- `./node_modules/.bin/vitest run test/update-store-catalogue.test.ts test/update-store-intent.test.ts` — PASS (W2 Tasks 4 and 6 unchanged: "never touches notifiedAt …" still green, and the array holds no duplicate).
- `./node_modules/.bin/vitest run test/mail-hardening.test.ts` — PASS (no `mail_deliveries` write added; the new signature is one line).
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — PASS (the array is still defined once, in `shared/api.ts`; `store.ts` spells no bracket tuple of a vocabulary).
- `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` — PASS, printing the SAME `Tests` line Step 2 recorded (ruling R13: `shared/api.ts` is cited, and both of this task's edits there sit in the end-of-file block; a red means a line landed above a cited one — move it, never re-point the census). `session-hook` is a known load flake: re-run a red in isolation before reading it.
- `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — PASS (the new file compiles under `test/tsconfig.tests.json`; `everyWhyListed`/`everyWhyDeclared` compile only while the result's arms equal `MARK_WHYS` and each is an `UpdateStoreRefuseCode`; a known load flake — re-run in isolation before calling a red real).

- [ ] **Step 7: Mutation measurement**

Save the green files first, from the repo root — each mutation is restored from these copies, NEVER with `git checkout --` (which would discard this task's uncommitted work):

```bash
G="$(mktemp -d)"; cp server/src/coord/store.ts "$G/store.ts"; cp shared/api.ts "$G/api.ts"
```

Each row: make the edit, run the named file(s) from `server/`, see the named case(s) red, then `cp "$G/store.ts" server/src/coord/store.ts` (or `cp "$G/api.ts" shared/api.ts`) and re-run green.

| # | §18 row / guard | Edit | Run | Red |
|---|---|---|---|---|
| 1 | "one push per tag, across restarts" (the store half) | in `markReleaseNotified`, `'UPDATE releases SET notifiedAt = ? WHERE tag = ? AND notifiedAt IS NULL'` → `'UPDATE releases SET notifiedAt = ? WHERE tag = ?'` | `test/update-store-notified.test.ts` | "a second mark of the same tag …" (`expected { ok: true, notifiedAt: 1790000000020 } to deeply equal { ok: false, …(2) }`) and "a restarted process reads the committed mark …" (`{ ok: true, notifiedAt: 1790000000099 }`) |
| 2 | `bad-tag` decided before SQL | delete the line `    if (!isReleaseTag(tag)) return { ok: false, why: 'bad-tag', tag };` | `test/update-store-notified.test.ts` | "a malformed tag is bad-tag …" (`"0.0.9": expected { ok: false, …(2) } to deeply equal { ok: false, why: 'bad-tag', …(1) }` — it answers `unknown-release`) |
| 3 | the read-back tells the two zero-change answers apart | replace the three-line `return row === undefined ? … : …;` with `return { ok: false, why: 'unknown-release', tag };` | `test/update-store-notified.test.ts` | "a second mark …" and "a restarted process …" |
| 4 | the `at` guard (NaN binds NULL) | delete the three-line `if (!Number.isSafeInteger(at) \|\| at < 0) { throw … }` block | `test/update-store-notified.test.ts` | "an \`at\` that is not a non-negative integer throws …" (`AssertionError: NaN`) |
| 5 | W2 "one writer per column group" — a catalogue column in the notifier | `'UPDATE releases SET notifiedAt = ? WHERE` → `'UPDATE releases SET notifiedAt = ?, yanked = 0 WHERE` | `test/update-store-notified.test.ts test/update-writer-groups.test.ts` | "every column a statement writes is owned …" with `markReleaseNotified (store.ts:N) writes releases.yanked — the catalogue group's writers are applyReleaseListing`, and "writes notifiedAt ONLY …" (the draft's `yanked` flips) |
| 6 | W2 "one writer per column group" — `notifiedAt` in the catalogue writer | in `applyReleaseListing`'s upsert, `'notes = excluded.notes, yanked = excluded.yanked, observedAt = excluded.observedAt',` → `'notes = excluded.notes, yanked = excluded.yanked, observedAt = excluded.observedAt, notifiedAt = NULL',` | `test/update-store-notified.test.ts test/update-writer-groups.test.ts test/update-store-catalogue.test.ts` | "every column a statement writes is owned …" with `applyReleaseListing (store.ts:N) writes releases.notifiedAt — the notification group's writers are markReleaseNotified`; "a later listing of the same tag keeps the mark …"; and W2's "never touches notifiedAt …" |
| 7 | the attribution and the W3 floor | rewrite the signature as three lines: `  markReleaseNotified(` / `    tag: string, at: number,` / `  ): MarkReleaseNotifiedResult {` | `test/update-writer-groups.test.ts` | "finds every W2 and W3 writer writing …" (`the scan found no statement of markReleaseNotified writing an update table`) and "store.ts carries no write the scan cannot attribute" (`store.ts:N: the walk-back crossed a method close — the signature of the method writing releases is not single-line`) |
| 8 | R5 — the words are declared, and the scanner reads them | in `shared/api.ts`, delete the line `  'unknown-release', 'already-notified',` | `test/mail-routes.test.ts -t 'every quoted kebab token'` and `test/update-store-notified.test.ts` | the scan names `unknown-release`; "its refusal words are declared …" at `unknown-release: expected false to be true`. Restore; then append `'bad-tag',` to that line (a duplicate) → the same case red at `a word is declared twice` |

Rows 1–7 were measured on the scratch tree named above this task's steps; row 8's `mail-routes` half is the real tree's (the scan is not in the scratch tree). After the last restore, `diff "$G/store.ts" server/src/coord/store.ts && diff "$G/api.ts" shared/api.ts` prints nothing, and Step 6's first three commands PASS again.

- [ ] **Step 8: Commit**

Run first: `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts` (a new file is added) — Expected: PASS.

```bash
git add server/src/coord/store.ts shared/api.ts server/test/update-store-notified.test.ts server/test/update-writer-groups.test.ts
git commit -m "feat(update): markReleaseNotified — the notification group's one writer, guarded in its WHERE, never un-marks (W3 Task 1)"
```

### Task 2: The notifier's decision (L1)

**Files:**
- Create: `server/src/update/notify.ts` — L1; imports `'../../../shared/api.js'`, `'../../../shared/semver.js'` and `'./resolve.js'` only (R7)
- Modify: `server/test/single-definition.test.ts` — the ONE `UPDATE_RING_FILES` line W2 Task 13 left (`  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts'];`) is replaced IN PLACE by the same line with `'notify.ts'` appended — line-neutral against the audit's anchors into this file (`:32-37`, `:1274`, `:1303`; census 8), R13. Match the line by its CONTENT and keep its leading whitespace (W2 Task 7 put it at a two-space indent inside the appended top-level describe).
- Test: `server/test/update-notify.test.ts` (create)
- Run, not modified: `server/test/session-hook.test.ts` (R13), `server/test/typecheck-tests.test.ts`, W2's `server/test/update-resolve.test.ts` (its own ring case reads `resolve.ts`'s import block, which this task does not touch), `server/test/topology-clean.test.ts` (two new files)

**Interfaces:**
- Consumes: `eligibleTags(releases: readonly EligibilityRow[], channel: UpdateChannel, refused: ReadonlySet<string>): string[]` (newest first, sorted by `compareReleaseTags`, a non-tag row filtered out by its `not-in-catalogue` arm) and `EligibilityRow { tag; channel: UpdateChannel | null; bundleListed; yanked }` (W2 Task 12, `resolve.ts`) — called with an EMPTY refused set: a per-node refusal does not make a release less news to the fleet; `isNewerTag` (W2 Task 2, `shared/semver.ts`; throws `RangeError` on a non-tag, so every call is behind `isReleaseTag`); `isReleaseTag`, `NotifyMode`, `UpdateChannel` (W2 Task 1). *(Correction: the skeleton also listed `compareReleaseTags`; `notify.ts` never orders two tags itself — `eligibleTags` does, once — so it imports `isNewerTag` alone from `semver.ts`, and the file's three import specifiers are unchanged.)* `ReleaseRow` (W2 Task 4), `NodeRow` (W2 Task 5) and `UpdateIntentRow` (W2 Task 6) satisfy the three input shapes structurally; nothing in `notify.ts` imports `store.ts` — the test checks the fit at compile time (`releaseRowFits`/`nodeRowFits`/`intentRowFits`, below), so a W2 column renamed under the notifier is a `typecheck-tests` red, not a silent `undefined`.
- Produces (in `server/src/update/notify.ts` — PURE):

```ts
export interface NotifyReleaseRow extends EligibilityRow { notifiedAt: number | null }
export interface NotifyNodeRow { measuredAt: number | null; currentVersion: string | null }
export interface NotifyInput {
  /** update_intent[FLEET_SCOPE] — the ONE row that governs the release push; null = the seed row is gone → nothing */
  fleetIntent: { notify: NotifyMode; channel: UpdateChannel | null } | null;
  releases: readonly NotifyReleaseRow[];
  /** nodes() — live rows only (superseded excluded), placeholders included */
  nodes: readonly NotifyNodeRow[];
}
export interface ReleaseNotification {
  tag: string;
  channel: UpdateChannel;   // 'stable' under notify 'stable'; the fleet's resolved '*' channel under notify 'channel'
  push: boolean;            // false = mark only (D-3294)
}
/** null = nothing to decide, nothing to mark: notify 'off'; no '*' row; notify 'channel' with a NULL channel
 *  (an unknown token, D-3181); no eligible release on the target channel; the candidate's notifiedAt is set;
 *  or no node has measuredAt !== null (D-3300).
 *  Candidate = eligibleTags(releases, target, ∅)[0] — ONLY the newest; an older unnotified tag is never announced.
 *  push = some node with measuredAt !== null has currentVersion null, not a tag, or older than the candidate. */
export function releaseToNotify(input: NotifyInput): ReleaseNotification | null;
```

- Module-private (not exported, not part of the contract): `NO_REFUSALS` (the empty refused set) and `notifyChannel(notify, fleetChannel): UpdateChannel | null` (`off` → null, `stable` → `'stable'`, `channel` → the fleet's channel, null included).
- The rule, table form (each row a case in `update-notify.test.ts`): `off` → `null`; `stable` → newest stable, `bundleListed`, not yanked (a newer dev tag is skipped, on a dev fleet too); `channel` on `dev` → newest eligible of either channel (a stable release counts on dev, spec §9); `channel` on `stable` → newest stable; the candidate already notified → `null` even when an older tag is unnotified; every measured node at or above the candidate → `{push: false}`; one measured node unversioned (`currentVersion: null`) → `{push: true}`; one measured node's `currentVersion` not a tag → `{push: true}` (and the comparator is never reached); no measured node → `null`; a `measuredAt: null` placeholder beside a current measured node → `{push: false}`; `v0.0.10` beats `v0.0.9`, as the candidate and in the behind test.
- Spec §18 rows pinned: "`notify` gates the push" (the decision half: `stable` returns no dev tag). Mutations: return a dev tag under `stable` → red; drop the `notifiedAt !== null` check → red ("already notified → null"); drop the measured filter → red ("placeholder is not unversioned"); compare by string → red (`v0.0.10`). Plus the ring: a planted coord-db import reds both this file's import-block case and W2's update-ring scan.

The test and the module below were measured on a scratch tree carrying W2 Task 2's `shared/semver.ts` and W2 Task 12's `resolve.ts` code blocks verbatim (with a stub of W2 Task 1's `isReleaseTag` and the three row types): the red in Step 2, the 20 greens in Step 4, `tsc --strict` clean over both files, and every mutation in Step 5 behaved exactly as written there.

- [ ] **Step 1: Write the failing test, and list the file in the update ring**

Create `server/test/update-notify.test.ts`:

```ts
// Design 2026-09-20 §13 (W3 Task 2) — the release notifier's DECISION: which
// tag a release push announces, on which channel, and whether the mark carries
// a push at all. `releaseToNotify` is L1: every case is a value in, a value
// out, so nothing here needs a fixture home, a store or a push double (Task 3
// wires it to all three). And the import block that keeps it L1 is read below.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  releaseToNotify, type NotifyInput, type NotifyNodeRow, type NotifyReleaseRow,
} from '../src/update/notify.js';
import type { NodeRow, ReleaseRow, UpdateIntentRow } from '../src/coord/store.js';
import type { NotifyMode, UpdateChannel } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const T0 = 1_790_000_000_000;

// The store's rows ARE the inputs, structurally — notify.ts imports nothing
// from store.ts, so this is the one place that claim is checked (by
// `typecheck-tests.test.ts`; asserted below so the lines are read). A W2 column
// renamed or retyped under the notifier is a compile error here, not a silent
// `undefined` in production.
const releaseRowFits: [ReleaseRow] extends [NotifyReleaseRow] ? true : never = true;
const nodeRowFits: [NodeRow] extends [NotifyNodeRow] ? true : never = true;
const intentRowFits: [UpdateIntentRow] extends [NonNullable<NotifyInput['fleetIntent']>] ? true : never = true;

const rel = (tag: string, channel: UpdateChannel | null = 'stable', o: Partial<NotifyReleaseRow> = {}): NotifyReleaseRow =>
  ({ tag, channel, bundleListed: true, yanked: false, notifiedAt: null, ...o });
const measured = (currentVersion: string | null): NotifyNodeRow => ({ measuredAt: T0, currentVersion });
/** `markUnreachable`'s label placeholder: a row, never measured. */
const PLACEHOLDER: NotifyNodeRow = { measuredAt: null, currentVersion: null };
const fleet = (notify: NotifyMode, channel: UpdateChannel | null = 'stable'): NotifyInput['fleetIntent'] => ({ notify, channel });
/** The seed intent ('*': stable, notify channel), one stable release, a fleet and a server both behind it. */
const input = (o: Partial<NotifyInput> = {}): NotifyInput => ({
  fleetIntent: fleet('channel'), releases: [rel('v0.0.9')], nodes: [measured('v0.0.7'), measured('v0.0.7')], ...o,
});

describe('releaseToNotify — which tag, on which channel (design 2026-09-20 §13)', () => {
  it('the structural fits hold — the store rows are the inputs', () => {
    expect([releaseRowFits, nodeRowFits, intentRowFits]).toEqual([true, true, true]);
  });

  it('the seed intent announces the newest stable release, with a push, to a fleet behind it', () => {
    expect(releaseToNotify(input())).toEqual({ tag: 'v0.0.9', channel: 'stable', push: true });
  });

  it("notify 'off' decides nothing — there is nothing to mark either", () => {
    expect(releaseToNotify(input({ fleetIntent: fleet('off') }))).toBeNull();
    expect(releaseToNotify(input({ fleetIntent: fleet('off', 'dev'), releases: [rel('v0.0.10', 'dev')] }))).toBeNull();
  });

  it("no '*' row decides nothing — a per-node row is never an input", () => {
    expect(releaseToNotify(input({ fleetIntent: null }))).toBeNull();
  });

  it("notify 'channel' on a channel this build cannot read decides nothing — never the stable default (D-3181)", () => {
    expect(releaseToNotify(input({ fleetIntent: fleet('channel', null) }))).toBeNull();
  });

  it("notify 'stable' skips a newer dev tag, on a dev fleet too (§18 \"notify gates the push\")", () => {
    const releases = [rel('v0.0.10', 'dev'), rel('v0.0.9', 'stable')];
    expect(releaseToNotify(input({ fleetIntent: fleet('stable', 'dev'), releases })))
      .toEqual({ tag: 'v0.0.9', channel: 'stable', push: true });
    expect(releaseToNotify(input({ fleetIntent: fleet('stable', 'stable'), releases })))
      .toEqual({ tag: 'v0.0.9', channel: 'stable', push: true });
    // …and with only dev releases listed there is nothing on stable to announce.
    expect(releaseToNotify(input({ fleetIntent: fleet('stable', 'dev'), releases: [rel('v0.0.10', 'dev')] }))).toBeNull();
  });

  it("notify 'channel' on dev announces the newest of either channel — a stable release counts on dev (§9)", () => {
    expect(releaseToNotify(input({ fleetIntent: fleet('channel', 'dev'),
      releases: [rel('v0.0.10', 'dev'), rel('v0.0.9', 'stable')] })))
      .toEqual({ tag: 'v0.0.10', channel: 'dev', push: true });
    expect(releaseToNotify(input({ fleetIntent: fleet('channel', 'dev'),
      releases: [rel('v0.0.11', 'stable'), rel('v0.0.10', 'dev')] })))
      .toEqual({ tag: 'v0.0.11', channel: 'dev', push: true });
  });

  it("notify 'channel' on stable skips a dev tag", () => {
    expect(releaseToNotify(input({ releases: [rel('v0.0.10', 'dev'), rel('v0.0.9', 'stable')] })))
      .toEqual({ tag: 'v0.0.9', channel: 'stable', push: true });
  });

  it('an ineligible newest row is never the candidate — yanked, bundle not listed, or a channel this build cannot read', () => {
    for (const over of [{ yanked: true }, { bundleListed: false }, { channel: null }] as const) {
      const releases = [rel('v0.0.10', 'stable', over), rel('v0.0.9')];
      expect(releaseToNotify(input({ releases })), JSON.stringify(over)).toEqual({ tag: 'v0.0.9', channel: 'stable', push: true });
    }
    expect(releaseToNotify(input({ releases: [rel('v0.0.9', 'stable', { yanked: true })] }))).toBeNull();
    expect(releaseToNotify(input({ releases: [] }))).toBeNull();
  });

  it('tag order is semver, never string order: v0.0.10 is newer than v0.0.9, in either list order', () => {
    expect(releaseToNotify(input({ releases: [rel('v0.0.9'), rel('v0.0.10')] }))?.tag).toBe('v0.0.10');
    expect(releaseToNotify(input({ releases: [rel('v0.0.10'), rel('v0.0.9')] }))?.tag).toBe('v0.0.10');
  });

  it('a candidate already notified decides nothing — even when an OLDER eligible tag was never announced', () => {
    const releases = [rel('v0.0.10', 'stable', { notifiedAt: T0 }), rel('v0.0.9')];
    expect(releaseToNotify(input({ releases }))).toBeNull();
    // The control: the same list with the candidate unmarked decides the candidate.
    expect(releaseToNotify(input({ releases: [rel('v0.0.10'), rel('v0.0.9')] })))
      .toEqual({ tag: 'v0.0.10', channel: 'stable', push: true });
  });
});

describe('push, or mark only (D-3294, D-3300)', () => {
  it('a current fleet: marked, not pushed — every measured node runs the candidate', () => {
    expect(releaseToNotify(input({ nodes: [measured('v0.0.9'), measured('v0.0.9')] })))
      .toEqual({ tag: 'v0.0.9', channel: 'stable', push: false });
  });

  it('a node already PAST the candidate (a hand-deployed newer build) counts as current', () => {
    expect(releaseToNotify(input({ nodes: [measured('v0.0.10'), measured('v0.0.9')] })))
      .toEqual({ tag: 'v0.0.9', channel: 'stable', push: false });
  });

  it('one node behind is enough to push', () => {
    expect(releaseToNotify(input({ nodes: [measured('v0.0.9'), measured('v0.0.8')] }))?.push).toBe(true);
  });

  it('an unversioned node (currentVersion null) is behind — nothing proves it current', () => {
    expect(releaseToNotify(input({ nodes: [measured('v0.0.9'), measured(null)] }))?.push).toBe(true);
  });

  it('a currentVersion that is not a tag is behind, and never reaches the comparator (which throws on it)', () => {
    for (const v of ['0.0.9', 'v0.0', 'garbage', '']) {
      expect(releaseToNotify(input({ nodes: [measured('v0.0.9'), measured(v)] }))?.push, v).toBe(true);
    }
  });

  it('the behind test is semver too: a node on v0.0.9 is behind v0.0.10', () => {
    expect(releaseToNotify(input({ releases: [rel('v0.0.10')], nodes: [measured('v0.0.10'), measured('v0.0.9')] })))
      .toEqual({ tag: 'v0.0.10', channel: 'stable', push: true });
  });

  it('no measured node: no decision, nothing to mark — the empty fleet and the placeholder-only fleet alike', () => {
    expect(releaseToNotify(input({ nodes: [] }))).toBeNull();
    expect(releaseToNotify(input({ nodes: [PLACEHOLDER] }))).toBeNull();
    expect(releaseToNotify(input({ nodes: [PLACEHOLDER, PLACEHOLDER] }))).toBeNull();
  });

  it('a placeholder row is not an unversioned node — beside a current measured node the tag is marked, not pushed', () => {
    expect(releaseToNotify(input({ nodes: [measured('v0.0.9'), PLACEHOLDER] })))
      .toEqual({ tag: 'v0.0.9', channel: 'stable', push: false });
  });
});

describe('the ring (design 2026-09-20 §6; the update ring scan in single-definition.test.ts)', () => {
  it('notify.ts imports only shared/api, shared/semver and the L1 resolver — no fs, no store, no push', () => {
    const src = readFileSync(path.join(here, '..', 'src', 'update', 'notify.ts'), 'utf8');
    const specs = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'|^\s*import\s+'([^']+)'/gm)]
      .map((m) => m[1] ?? m[2]);
    expect(specs.length).toBeGreaterThan(0);
    expect(new Set(specs)).toEqual(new Set(['../../../shared/api.js', '../../../shared/semver.js', './resolve.js']));
    expect(/\brequire\(|import\(/.test(src)).toBe(false);
  });
});
```

In `server/test/single-definition.test.ts`, inside `describe('the update ring — nothing under server/src/update holds the handle (design 2026-09-20 §6)', …)`, replace the one line

```ts
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts'];
```

with

```ts
  const UPDATE_RING_FILES: readonly string[] = ['catalogue.ts', 'inventory.ts', 'resolve.ts', 'project.ts', 'routes.ts', 'notify.ts'];
```

Check it is one line for one line before running anything: `git diff --numstat -- server/test/single-definition.test.ts` — Expected: `1	1	server/test/single-definition.test.ts`.

- [ ] **Step 2: Run them to verify they fail**

Run, from `server/`, one at a time, foreground (timeout ≥ 600000 ms):
- `./node_modules/.bin/vitest run test/update-notify.test.ts` — Expected: FAIL, `Error: Cannot find module '../src/update/notify.js' imported from …/server/test/update-notify.test.ts`, `Tests  no tests`.
- `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the update ring'` — Expected: FAIL, exactly one case: "covers the directory — absent means nothing expects it, present means every listed file is visited (never a skip)", with `notify.ts is listed but not on disk`. The other two update-ring cases PASS.

- [ ] **Step 3: Create `server/src/update/notify.ts`**

```ts
// L1 — THE RELEASE NOTIFIER'S DECISION (design 2026-09-20 §13; W3). Pure:
// values in, one value out — no fs, no store, no push, no clock.
// `FleetWatcher.pushRelease` (watch.ts, L4) reads the store, calls this, marks
// the answer's tag and, iff it says so, sends; this file decides WHICH tag, on
// WHICH channel, and whether the mark carries a push. Ring membership is a
// property of the import block below — two shared/ modules and the L1
// resolver, nothing else — and update-notify.test.ts pins it by reading it.
//
// Eligibility is the resolver's ONE predicate (`eligibleTags`), never a second
// copy here: a tag this file announces is a tag the resolver would offer on
// that channel. It is asked with an EMPTY refused set — one node's
// provenance refusal makes a release no less news to the operator.
import { isReleaseTag, type NotifyMode, type UpdateChannel } from '../../../shared/api.js';
import { isNewerTag } from '../../../shared/semver.js';
import { eligibleTags, type EligibilityRow } from './resolve.js';

/** A catalogue row as the notifier reads it: the eligibility columns plus the
 *  notification group's one column. `ReleaseRow` (store.ts) satisfies it. */
export interface NotifyReleaseRow extends EligibilityRow { notifiedAt: number | null }
/** A live inventory row as the notifier reads it. `NodeRow` (store.ts) satisfies
 *  it. `measuredAt: null` = never measured (a `markUnreachable` placeholder). */
export interface NotifyNodeRow { measuredAt: number | null; currentVersion: string | null }
export interface NotifyInput {
  /** update_intent[FLEET_SCOPE] — the ONE row that governs the release push; null = the seed row is gone → nothing */
  fleetIntent: { notify: NotifyMode; channel: UpdateChannel | null } | null;
  releases: readonly NotifyReleaseRow[];
  /** nodes() — live rows only (superseded excluded), placeholders included */
  nodes: readonly NotifyNodeRow[];
}
export interface ReleaseNotification {
  tag: string;
  channel: UpdateChannel;   // 'stable' under notify 'stable'; the fleet's resolved '*' channel under notify 'channel'
  push: boolean;            // false = mark only (D-3294)
}

/** A release is news to the fleet, not to one node: no node's refusal is an input. */
const NO_REFUSALS: ReadonlySet<string> = new Set<string>();

/** The channel whose newest release `notify` announces, or null for none. `stable`
 *  is stable promotions only, whatever the fleet follows; `channel` is the
 *  fleet's own resolved '*' channel, and a NULL one (a token this build cannot
 *  read, D-3181) announces nothing — never the stable default. */
function notifyChannel(notify: NotifyMode, fleetChannel: UpdateChannel | null): UpdateChannel | null {
  switch (notify) {
    case 'off': return null;
    case 'stable': return 'stable';
    case 'channel': return fleetChannel;
  }
}

/** null = nothing to decide, nothing to mark: notify 'off'; no '*' row; notify 'channel' with a NULL channel
 *  (an unknown token, D-3181); no eligible release on the target channel; the candidate's notifiedAt is set;
 *  or no node has measuredAt !== null (D-3300).
 *  Candidate = eligibleTags(releases, target, ∅)[0] — ONLY the newest; an older unnotified tag is never announced.
 *  push = some node with measuredAt !== null has currentVersion null, not a tag, or older than the candidate. */
export function releaseToNotify(input: NotifyInput): ReleaseNotification | null {
  if (input.fleetIntent === null) return null;
  const channel = notifyChannel(input.fleetIntent.notify, input.fleetIntent.channel);
  if (channel === null) return null;
  // A placeholder row is UNMEASURED, not unversioned: on a fleet nobody has
  // measured yet, "no node is older" is vacuously true and would mark the tag
  // with no push, losing it for good. Wait for the sweep that measures.
  const measured = input.nodes.filter((n) => n.measuredAt !== null);
  if (measured.length === 0) return null;
  const tag = eligibleTags(input.releases, channel, NO_REFUSALS)[0];
  if (tag === undefined) return null;
  // Only the newest is ever a candidate, so a tag already announced silences
  // every older one — an operator who heard of v0.0.10 needs no v0.0.9 push.
  if (input.releases.find((r) => r.tag === tag)?.notifiedAt !== null) return null;
  // D-3294: a release every measured node already runs (or
  // runs past) is marked, not pushed. Unversioned and unreadable versions are
  // behind by definition — nothing proves them current.
  const push = measured.some((n) => !isReleaseTag(n.currentVersion) || isNewerTag(tag, n.currentVersion));
  return { tag, channel, push };
}
```

(Task 3 appends the push copy — `RELEASE_PUSH_URL`, `releasePushTag`, `ReleasePushCopy`, `releasePushCopy` — after `releaseToNotify`, adding no import, so the ring case below stays exact.)

- [ ] **Step 4: Run green**

Run, from `server/`, one at a time, foreground (timeout ≥ 600000 ms):
- `./node_modules/.bin/vitest run test/update-notify.test.ts` — PASS, 20 cases across three describes (11 + 8 + 1).
- `./node_modules/.bin/vitest run test/single-definition.test.ts -t 'the update ring'` — PASS, 3 cases: `notify.ts` is on disk, and it imports neither `node:sqlite` nor a coord db module and names no handle.
- `./node_modules/.bin/vitest run test/single-definition.test.ts` — PASS, the whole file, the same case count as before this task (the edit replaced one line and added no case).
- `./node_modules/.bin/vitest run test/update-resolve.test.ts` — PASS (untouched; the eligibility predicate `notify.ts` calls is its subject).
- `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` — PASS, the same `Tests` line as before this task (R13: `single-definition.test.ts` is cited, census 8, and Step 1's edit is one line for one line). `session-hook` is a known load flake: re-run a red in isolation before reading it.
- `./node_modules/.bin/vitest run test/typecheck-tests.test.ts` — PASS (the three structural fits compile only while `ReleaseRow`, `NodeRow` and `UpdateIntentRow` carry the columns the notifier reads, with those types; a known load flake — re-run in isolation before calling a red real).

- [ ] **Step 5: Mutation measurement**

Save the green file first, from the repo root — each mutation is restored from the copy, NEVER with `git checkout --`:

```bash
G="$(mktemp -d)"; cp server/src/update/notify.ts "$G/notify.ts"
```

Each row: make the edit in `server/src/update/notify.ts`, run `cd server && ./node_modules/.bin/vitest run test/update-notify.test.ts` (plus the file named), see the named case(s) red, `cp "$G/notify.ts" server/src/update/notify.ts`, re-run green.

| # | §18 row / departure | Edit | Red |
|---|---|---|---|
| 1 | "`notify` gates the push" — a dev tag under `stable` | `    case 'stable': return 'stable';` → `    case 'stable': return fleetChannel;` | "notify 'stable' skips a newer dev tag, on a dev fleet too (§18 …)" (it announces `v0.0.10` on `dev`) |
| 2 | once per tag (the decision half) | delete the line `  if (input.releases.find((r) => r.tag === tag)?.notifiedAt !== null) return null;` | "a candidate already notified decides nothing — even when an OLDER eligible tag was never announced" |
| 3 | only the newest is a candidate | `const tag = eligibleTags(input.releases, channel, NO_REFUSALS)[0];` → `const tag = eligibleTags(input.releases, channel, NO_REFUSALS).find((t) => input.releases.find((r) => r.tag === t)?.notifiedAt === null);` | "a candidate already notified decides nothing …" (it announces the older `v0.0.9`) |
| 4 | D-3300 — a placeholder is unmeasured | `const measured = input.nodes.filter((n) => n.measuredAt !== null);` → `const measured = input.nodes;` | "no measured node: no decision …" and "a placeholder row is not an unversioned node …" |
| 5 | D-3300 — an empty measurement decides nothing | delete the line `  if (measured.length === 0) return null;` | "no measured node: no decision …" (`{push: false}` for `nodes: []`) |
| 6 | D-3294 | `const push = measured.some((n) => !isReleaseTag(n.currentVersion) \|\| isNewerTag(tag, n.currentVersion));` → `const push = true;` | "a current fleet: marked, not pushed …", "a node already PAST the candidate …" and "a placeholder row is not an unversioned node …" |
| 7 | tag order is semver | `isNewerTag(tag, n.currentVersion)` → `tag > n.currentVersion` | "the behind test is semver too: a node on v0.0.9 is behind v0.0.10" (and three more cases whose fleets straddle a digit-count boundary) |
| 8 | the ring (L1 by its imports) | add `import { tx } from '../coord/db.js';` below the `./resolve.js` import; run `test/single-definition.test.ts -t 'the update ring'` too | "notify.ts imports only shared/api, shared/semver and the L1 resolver …" and the update ring's "no file there imports node:sqlite or a coord db module …" (`notify.ts imports a coord db module`) |

Rows 1–8's `update-notify` reds were measured on the scratch tree named above; row 8's `single-definition` half is the real tree's. After the last restore, `diff "$G/notify.ts" server/src/update/notify.ts` prints nothing and Step 4's first two commands PASS again.

- [ ] **Step 6: Commit**

Run first: `cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts` (two new files) — Expected: PASS.

```bash
git add server/src/update/notify.ts server/test/update-notify.test.ts server/test/single-definition.test.ts
git commit -m "feat(update): releaseToNotify — the release notifier's pure decision: the newest eligible tag on the notify channel, marked with or without a push (W3 Task 2)"
```

### Task 3: The release push

**Files:**
- Create: `shared/update-summary.ts` — L0, imports nothing (D-3301). `pwa/tsconfig.json`'s `include` names `../shared`, so the PWA's `tsc --noEmit` (strict, `noUncheckedIndexedAccess`, `noUnusedLocals`, `verbatimModuleSyntax`, `erasableSyntaxOnly`) compiles this file from the moment it exists, before any PWA file imports it.
- Modify: `server/src/update/notify.ts` — the copy, appended after the file's last line (Task 2's `releaseToNotify`); it takes the summary as a string argument, so `notify.ts` gains no import.
- Modify: `server/src/push.ts` — `PushPayload` (`push.ts:15-24`) gains `url?: string` after `tag?` (`:19`) with its one-line comment.
- Modify: `server/src/watch.ts` —
  - imports: `FLEET_SCOPE` added IN PLACE to the ONE-LINE `shared/api.js` value import (`watch.ts:34`) — the line stays one line, so `single-definition.test.ts`'s `import .*UNCHECKED_PR.*from '..shared/api'` scan (`:131-135`) still matches it; `type MarkReleaseNotifiedResult` added IN PLACE to the `./coord/store.js` import (`:57`); two new lines directly after W2 Task 12's `import { resolveAndProject, type ProjectionOutcome } from './update/project.js';` — `releasePushCopy`, `releaseToNotify`, `type ReleaseNotification` from `'./update/notify.js'` and `versionsSummary` from `'../../shared/update-summary.js'`;
  - `export type ReleasePushOutcome` between `mergedKey` (`:370` at `d759c914`) and `export class FleetWatcher` (`:372` at `d759c914`) — W2 Tasks 10–12 insert above both (the inventory/projection imports after `:61`, the two update cadences and `projectionWhy` after `:191`), so find them by their text, not by number;
  - `private lastReleasePushFailure` and `private inventorySwept` directly after W2 Task 12's `private lastProjectionWhy: string | null = null;`;
  - public `pushRelease(now: number): ReleasePushOutcome` and public `pushReleaseAfterPoll(now: number): ReleasePushOutcome` directly after W2 Task 12's `private async sweepThenProject(…)`;
  - two call sites: (a) W2 Task 10's catalogue gate in `tick()` — quoted `void this.deps.catalogue.poll(Date.now()).catch(() => { /* one bad poll must not kill the tick */ });` — becomes `void this.deps.catalogue.poll(Date.now()).then(() => { this.pushReleaseAfterPoll(Date.now()); }).catch(() => { /* one bad poll must not kill the tick */ });` under a three-line comment; (b) inside `sweepThenProject`, after the `this.lastProjectionWhy = why;` line and before `return outcomes;`, two statements `this.inventorySwept = true;` and `this.pushRelease(now);` under a four-line comment.
  - `watch.ts` is cited by no document in the session-hook audit's corpus (W2 Task 12, measured), so none of these inserts need be line-neutral.
- Modify: `server/src/update/routes.ts` (W2 Task 13) — the third call site: in the `app.post('/api/updates/refresh', …)` handler, after `await reproject(req);` and before `return state;`, one statement `watcher?.pushReleaseAfterPoll(Date.now());` under a three-line comment. It adds no import (`registerUpdateRoutes` already takes `watcher?: FleetWatcher`), so the update ring's REACH scan is unmoved; no document in the audit's corpus cites this W2 file.
- Modify: `server/test/update-routes.test.ts` (W2 Task 13) — one `import type { PushPayload } from '../src/push.js';` line directly after its `import type { CataloguePoller } from '../src/update/catalogue.js';`; `open()`'s options gain `push?` (spread into `deps` only when given); one describe APPENDED after the file's last line. No document in the audit's corpus cites it.
- Modify: `server/test/push-copy.test.ts` — three import lines edited in place (`:1`, `:17`, `:19`) and five added after `:20`; the `watcher()` factory (`:106-157`) is replaced by the version in Step 9, which makes `push` optional (spread into the deps only when given — the no-push-service case omits it) and adds three optional inputs (`cfg?: Partial<CcrcConfig>`, `catalogue?: CataloguePoller`, `home?: string`), returns the `FleetWatcher` as `w`, and keeps its state cache inside the fixture home; one describe APPENDED after the file's last line (`:1049` at `d759c914`). W2 does not touch this file, and no document in the audit's corpus cites it.
- Modify: `server/test/single-definition.test.ts` — one describe APPENDED after the file's last line, whichever describe W2 left last there (W2 Tasks 1, 7 and 8 each append one at end of file — Task 7's update ring and Task 8's `describe('one NODE_FILES — the ~/.ccrc node-file basenames', …)` among them; this wave's Task 2 only replaced one line inside the update ring): `'fleet and server are on '` is spelled in exactly one file across the four TS roots, `shared/update-summary.ts`. Appending moves none of the audit's anchors into this file (`:32-37`, `:1274`, `:1303`, `:1319-1320`; census 8), R13.
- Modify: `server/test/update-notify.test.ts` (Task 2's file) — Task 2's one import from `'../src/update/notify.js'` is a three-line statement; its middle line `  releaseToNotify, type NotifyInput, type NotifyNodeRow, type NotifyReleaseRow,` is replaced in place by one line that also names `RELEASE_PUSH_URL, releasePushCopy, releasePushTag` and `type ReleaseNotification` (Task 2 imports none of the four); one describe appended after the file's last line (the closing `});` of Task 2's `describe('the ring …')`).
- Test: `server/test/update-summary.test.ts` (create).
- Run, not modified: `server/test/session-hook.test.ts` (R13), `server/test/topology-clean.test.ts` (two new files), `server/test/typecheck-tests.test.ts`, and W2's watcher-lane suites `update-catalogue.test.ts`, `update-inventory.test.ts`, `update-projection.test.ts` (the watch.ts call sites run inside lanes those files drive), plus `caps-refresh.test.ts` (a tick with no `coord`).

**Interfaces:**
- Consumes: Task 1's `markReleaseNotified(tag, at): MarkReleaseNotifiedResult` (arms `{ok: true; notifiedAt}`, `bad-tag`/`unknown-release` carrying `tag`, `already-notified` carrying the stored `notifiedAt`; it THROWS `RangeError` on an `at` that is not a non-negative safe integer — a caller bug, which lands in `pushRelease`'s `failed` arm, the catch Task 1 relies on); Task 2's `releaseToNotify(input: NotifyInput): ReleaseNotification | null` and `ReleaseNotification { tag; channel: UpdateChannel; push: boolean }`; W2's `releases(): ReleaseRow[]`, `nodes(): NodeRow[]` (`role: NodeRole | null`, `currentVersion`, `measuredAt`), `intentFor(FLEET_SCOPE): UpdateIntentRow | null` (Tasks 4–6), `FLEET_SCOPE` (W2 Task 1, `shared/api.ts`, ruling R4), `cfg.role: NodeRole` (W2 Task 9), `Deps.catalogue?: CataloguePoller` (W2 Task 10), `sweepThenProject`, `lastProjectionWhy` (W2 Task 12), `inventoryNow()` (W2 Task 11); `registerUpdateRoutes(app, deps, sessionAuth, watcher?: FleetWatcher)` and its `POST /api/updates/refresh` handler, which calls `deps.catalogue.poll(now)` itself, outside any watcher lane (W2 Task 13); `PushService.notify(payload): Promise<void>` (`push.ts:68-87`, on `this.deps.push?` — `Deps.push` is optional, `server.ts:269`, and `index.ts:29-31` builds it only when both VAPID keys are configured). Tests only: `applyReleaseListing`, `ReleaseListingRow` (W2 Task 4), `upsertNodeMeasurement`, `NodeMeasurement` (Task 5), `setIntent`, `UpdateIntentPatch`, `UpdateIntentLog`, `defaultUpdateIntentLogPath` (Task 6), `SERVER_LABEL`, `FLEET_LABEL` (Task 11), `NODE_FILES` (Task 8, `shared/agent-protocol.ts`), `feedEvents(limit)` (`store.ts:3863` at `d759c914`; W2's store inserts move it), `NotifyLog.seq`, `Presence.setVisible`.
- Produces (in `shared/update-summary.ts` — L0, structural types, no import):

```ts
export interface SummaryRow { role: string | null; version: string | null }   // version: a tag, or null = unversioned
export const UNVERSIONED_WORD = 'unversioned';
export const MISSING_SIDE = '—';
/** server = the first row whose role is 'server' or 'both'; fleet = the first row whose role is 'fleet', else the
 *  server row when ITS role is 'both' (one box that is both — local mode). */
export function versionSides<T extends { role: string | null }>(rows: readonly T[]): { fleet: T | null; server: T | null };
/** row.version when a string, else UNVERSIONED_WORD; MISSING_SIDE for no row. */
export function sideVersion(row: SummaryRow | null): string;
/** 'fleet and server are on v0.0.7' when BOTH sides are present and run the SAME TAG, else
 *  `fleet ${sideVersion(fleet)} · server ${sideVersion(server)}` ('fleet v0.0.7 · server v0.0.9', 'fleet — · server v0.0.7',
 *  'fleet unversioned · server unversioned'). */
export function versionsSummary(rows: readonly SummaryRow[]): string;
```

- **Corrected against the skeleton (two docstrings, no signature):** (1) The skeleton called `versionSides`' order "W2 Task 14's `derivedBuilds` order". Only the SERVER pick matches: `derivedBuilds` (W2 Task 14) takes `own` = the first `server`/`both` row, but its `fleet` is the first `fleet` row with NO fallback, so in local mode `derivedBuilds` answers `fleet: null` where `versionSides` answers the `both` row. The fallback is this module's, argued in its docstring (one install is both sides), and `derivedBuilds` is not changed. (2) The skeleton's "both sides present and display the same" would render two unversioned sides as "fleet and server are on unversioned", which asserts a sameness nothing measured. The one-clause form needs both sides to carry the SAME TAG; two unversioned sides are named one by one. Pinned by the "two unversioned sides never agree" case and mutation M13.
- Produces (appended to `server/src/update/notify.ts`):

```ts
export const RELEASE_PUSH_URL = '/settings';
/** The tray collapse key — the ONE spelling, as `mergedKey` is the one spelling of the merged tag (watch.ts:365-370). */
export function releasePushTag(tag: string): string;          // `release-${tag}`
export interface ReleasePushCopy { title: string; body: string; tag: string; url: string }
/** title `ccrc ${n.tag} is out`; body `On ${n.channel} — ${summary}. Tap to see what's new.`;
 *  tag releasePushTag(n.tag); url RELEASE_PUSH_URL. */
export function releasePushCopy(n: ReleaseNotification, summary: string): ReleasePushCopy;
```

- Produces (in `server/src/push.ts`): `url?: string; // a same-origin path the SW opens on tap, ahead of /s/<sessionId>` on `PushPayload`.
- Produces (in `server/src/watch.ts`):

```ts
export type ReleasePushOutcome =
  | { did: 'skipped'; why: 'no-coord' | 'not-server-role' | 'no-push-service' | 'not-yet-swept' | 'nothing-to-notify' }
  | { did: 'marked'; tag: string }                                                   // notified, no push (D-3294)
  | { did: 'pushed'; tag: string; payload: PushPayload }
  | { did: 'refused'; tag: string; why: Extract<MarkReleaseNotifiedResult, { ok: false }>['why'] }  // the mark lost; nothing sent
  | { did: 'failed'; detail: string };                                               // a store read/write threw; nothing marked or sent

// FleetWatcher — PUBLIC for the inventory lane, the catalogue side and the tests (the inventoryNow() precedent); SYNCHRONOUS; never throws
pushRelease(now: number): ReleasePushOutcome;            // the inventory run's own call, and every test that decides directly
pushReleaseAfterPoll(now: number): ReleasePushOutcome;   // the catalogue side: tick()'s catalogue gate and POST /api/updates/refresh;
                                                         // 'not-yet-swept' until THIS process has finished one inventory run
private lastReleasePushFailure: string | null;   // warn once per change of reason (lastProjectionWhy's idiom)
private inventorySwept: boolean;                 // set by sweepThenProject, just before its own pushRelease call; never cleared
```

- **Found reviewing Task 3 (three additions):** (1) **No push service is its own arm.** `Deps.push` is absent on a box with no VAPID keys (`index.ts:29-31`). An unguarded `pushRelease` would have committed `notifiedAt` there and answered `pushed` with nothing sent, folding "sent" and "no sender" into one value (the no-overloaded-value rule) and using the tag up: configuring VAPID later would never announce it. `pushRelease` now answers `skipped/no-push-service` before it decides and marks nothing, so a sender configured later still announces a release the fleet is behind on (a release the fleet already runs is then only marked, D-3294). (2) **The *Check now* poll announces too.** W2's refresh handler calls `deps.catalogue.poll(now)` directly, outside `tick()`, so without its own call site a release found by *Check now* would be announced only by the next inventory run, up to 60 s later, and no test would pin that path. The handler now calls `watcher?.pushReleaseAfterPoll(Date.now())` after its `reproject`, pinned by an `update-routes.test.ts` case. (3) **The catalogue side waits for this process's first inventory run** (D-3314). Both lanes fire unawaited on a new process's first tick. Until that process's first sweep rewrites them, the `nodes` rows are the previous process's, and after a server-box update they still carry the version the update replaced. So a poll that resolves first would push "vX is out" to a fleet already on vX. `pushReleaseAfterPoll` answers `skipped/not-yet-swept` until `sweepThenProject` has set `inventorySwept`, and the inventory run's own call makes the first decision. `pushRelease` itself carries no gate, so the direct-decision cases keep seeding rows by hand.

- **Corrected against the skeleton (additive):** `refused`'s `why` is DERIVED from Task 1's `MarkReleaseNotifiedResult` (`'bad-tag' | 'unknown-release' | 'already-notified'` today) rather than restated, so a refusal Task 1's union gains is carried without a second list; `failed` warns once per change of reason through a new private field, `lastReleasePushFailure` (the skeleton said "warned once" and named no field); and the push-copy factory gains a third input, `home?`, plus the `w` return — the restart case needs a second watcher over the SAME `coord.db`, which a factory that always mints a fresh home cannot build.
- `pushRelease`'s order, each step a case: `deps.coord` absent → `skipped/no-coord`; `cfg.role` not `server`/`both` → `skipped/not-server-role`; `deps.push` absent → `skipped/no-push-service` (nothing decided, nothing marked); then, inside ONE `try` with no `await`: `intentFor(FLEET_SCOPE)`, `nodes()` (read once, used for the decision AND the summary), `releases()`, `releaseToNotify(…)` null → `skipped/nothing-to-notify`; `markReleaseNotified(tag, now)`; the summary `versionsSummary` over the MEASURED rows (`measuredAt !== null`) as `{role, version: currentVersion}`. A throw anywhere in that block → `failed` (warned once per reason, nothing marked beyond what committed, nothing sent). Then: the mark not ok → `refused` (NOTHING sent); `push: false` → `marked`; else `releasePushCopy`, THEN `const sending = sender.notify({ title, body, tag, url })` (`sender` = the `deps.push` checked above) and `void sending.catch(warn)`, return `pushed`. No `sessionId`, no presence check, no `NotifyLog`/feed record (D-3296). `pushReleaseAfterPoll`: `inventorySwept` false → `skipped/not-yet-swept`, else `pushRelease(now)`.
- The pinned copy (push-copy.test.ts, `sent[0]`): `title: 'ccrc v0.0.9 is out'`, `body: 'On stable — fleet and server are on v0.0.7. Tap to see what\'s new.'`, `tag: 'release-v0.0.9'`, `url: '/settings'`, keys exactly `body, tag, title, url` (so `sessionId` and `actions` are absent); the per-node form `On dev — fleet v0.0.7 · server v0.0.9. Tap to see what's new.`
- The appended describe's cases (19): the copy; the per-node form; a second `pushRelease` sends nothing and keeps the first mark; a NEW watcher over the same `coord.db` sends nothing, with the first connection CLOSED before the second opens; `notify: 'stable'` skips a dev tag; `notify: 'off'` sends nothing and marks nothing; a current fleet is marked with no push, and a newer tag listed afterwards is pushed; the mark is committed before `notify` is called (read on a second connection inside the send); a rejecting `notify` is not retried; a mark that loses sends nothing; a store that throws is `failed`, warned once, nothing sent; `cfg.role: 'fleet'` sends and marks nothing; no `coord` → `no-coord`; no push service → `no-push-service`, nothing marked, and a watcher with a sender over the same db then pushes the tag; a visible session does not suppress it; no feed row and no ring record; wired through the inventory lane (`inventoryNow()` on a local-mode fixture pushes once the sweep has measured the box, and not before); wired through the catalogue lane (one real `inventoryNow()` first, then a `catalogue` double whose `poll` calls `applyReleaseListing`, then one `tick()` with the inventory lane stubbed out); the catalogue lane waits for this process's first inventory run (a stale pre-restart row at the old version, the tick's poll lands first → `not-yet-swept`, nothing marked or sent; the run then measures the new version and marks with no push). Plus ONE `update-routes.test.ts` case: a refresh whose poll lists a newer tag sends one push from the request, after the GET's on-demand sweep.
- Spec §18 rows pinned: "one push per tag, across restarts" (a second sweep sends nothing; a restarted fixture sends nothing — mutation M1: skip `markReleaseNotified` → both red), "`notify` gates the push" (end to end — M2: pass `notify: 'channel'` regardless → the stable and off cases red), "the push lands on settings" (M3: drop `url` from the payload → the copy case reds; M11: the copy's url is not `/settings` → reds in both files). Plus D-3295 (M6), D-3296 (M4), D-3294 (the current-fleet case), D-3301 (M12–M14), the refresh route's call site (M15), the no-push-service arm (M16), D-3314 (M17, M18).
- **Departure this task adds (for the plan's `## Deviations found` list):** D-3314 — Found reviewing Task 3. The wave's decomposition (item 3) runs the release decision "after every catalogue poll AND every inventory sweep", and both lanes fire unawaited on a new process's first tick (W2's D-3198: the first tick polls and sweeps at once). A poll that resolves before this process's first sweep would decide on the `nodes` rows the PREVIOUS process wrote. After a server-box update those rows still carry the version the update replaced, so the decision would push "vX is out" to a fleet already on vX, which is the first-deploy noise D-3294 exists to prevent. The catalogue side (`tick()`'s catalogue gate and `POST /api/updates/refresh`) therefore goes through `pushReleaseAfterPoll`, which answers `skipped/not-yet-swept` until `sweepThenProject` has finished once in this process. That run's own call makes the first decision, on rows it has just measured. Pinned by the push-copy case "the catalogue lane waits for this process's first inventory run", and by M17 (the gate deleted) and M18 (the flag never set). Cost if wrong: a release listed in the first seconds after a restart is announced up to one inventory beat (60 s) later than its poll.

- [ ] **Step 1: Write the failing tests for the L0 summary**

Create `server/test/update-summary.test.ts`:

```ts
// The L0 summary clause (design 2026-09-20 §13; plan W3 Task 3, D-3301): the push body and
// the update banner both say what the nodes run through `versionsSummary`, so both forms are pinned here once.
import { describe, it, expect } from 'vitest';
import {
  MISSING_SIDE, UNVERSIONED_WORD, sideVersion, versionSides, versionsSummary, type SummaryRow,
} from '../../shared/update-summary.js';

const row = (role: string | null, version: string | null): SummaryRow => ({ role, version });

describe('versionsSummary — the clause the push body and the banner share', () => {
  it('one clause when both sides run the same tag', () => {
    expect(versionsSummary([row('server', 'v0.0.7'), row('fleet', 'v0.0.7')])).toBe('fleet and server are on v0.0.7');
    // order-independent: the fleet row listed first reads the same
    expect(versionsSummary([row('fleet', 'v0.0.7'), row('server', 'v0.0.7')])).toBe('fleet and server are on v0.0.7');
  });

  it('each side named when they differ — fleet first, then server', () => {
    expect(versionsSummary([row('server', 'v0.0.9'), row('fleet', 'v0.0.7')])).toBe('fleet v0.0.7 · server v0.0.9');
  });

  it('a missing side reads as the dash, never as agreement', () => {
    expect(versionsSummary([row('server', 'v0.0.7')])).toBe('fleet — · server v0.0.7');
    expect(versionsSummary([row('fleet', 'v0.0.7')])).toBe('fleet v0.0.7 · server —');
    expect(versionsSummary([])).toBe('fleet — · server —');
  });

  it('an unversioned side is named, and two unversioned sides never "agree"', () => {
    expect(versionsSummary([row('server', 'v0.0.7'), row('fleet', null)])).toBe('fleet unversioned · server v0.0.7');
    expect(versionsSummary([row('server', null), row('fleet', null)])).toBe('fleet unversioned · server unversioned');
  });

  it("local mode's one `both` row is both sides", () => {
    expect(versionsSummary([row('both', 'v0.0.7')])).toBe('fleet and server are on v0.0.7');
  });

  it('a row with no role, or a role outside the vocabulary, is on neither side', () => {
    expect(versionsSummary([row(null, 'v0.0.9'), row('mystery', 'v0.0.9'), row('server', 'v0.0.7')]))
      .toBe('fleet — · server v0.0.7');
  });
});

describe('versionSides and sideVersion', () => {
  it('server = the first server-or-both row; fleet = the first fleet row, else a both server row', () => {
    const s = row('server', 'v0.0.9'); const f = row('fleet', 'v0.0.7'); const b = row('both', 'v0.0.8');
    expect(versionSides([f, s])).toEqual({ fleet: f, server: s });
    expect(versionSides([b])).toEqual({ fleet: b, server: b });
    expect(versionSides([b, f])).toEqual({ fleet: f, server: b });   // a real fleet row beats the fallback
    expect(versionSides([s])).toEqual({ fleet: null, server: s });   // a server-role box is not the fleet
    expect(versionSides([])).toEqual({ fleet: null, server: null });
  });

  it('hands the caller its own row objects back (generic over the row type)', () => {
    const rows = [{ role: 'fleet', version: 'v0.0.7', label: 'fleet' }, { role: 'server', version: null, label: 'server' }];
    const sides = versionSides(rows);
    expect(sides.fleet).toBe(rows[0]);
    expect(sides.server?.label).toBe('server');
  });

  it('one side as text', () => {
    expect(sideVersion(null)).toBe(MISSING_SIDE);
    expect(sideVersion(row('fleet', null))).toBe(UNVERSIONED_WORD);
    expect(sideVersion(row('fleet', 'v0.0.10'))).toBe('v0.0.10');
    expect([MISSING_SIDE, UNVERSIONED_WORD]).toEqual(['—', 'unversioned']);
  });
});
```

Append to `server/test/single-definition.test.ts`, after the file's last line (the closing `});` of whichever describe W2 appended last — W2 Tasks 1, 7 and 8 each append one at end of file; do not look for the update ring specifically) — an append, so no cited anchor into this file moves (R13):

```ts

describe('the release summary clause is spelled once, in L0 (plan W3 Task 3)', () => {
  // D-3301: the release push's body (server) and the update banner (pwa) say the same
  // clause. A second spelling in either package is a sentence to keep in step by hand, so it has ONE holder
  // across the four TS roots — the L0 module both import.
  it("'fleet and server are on ' is spelled in shared/update-summary.ts and nowhere else", () => {
    const holders = ALL.filter((f) => readFileSync(f, 'utf8').includes('fleet and server are on ')).map(rel);
    expect(holders).toEqual(['shared/update-summary.ts']);
  });
});
```

(`ALL`, `rel` and `readFileSync` are the file's own — `:60`, `:61`, `:18`.)

- [ ] **Step 2: Run them red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-summary.test.ts` (foreground)
Expected: FAIL — `Error: Cannot find module '../../shared/update-summary.js' imported from …/server/test/update-summary.test.ts`, `Test Files  1 failed (1)`, `Tests  no tests` (measured with vitest 4.1.10 against this exact test file before the module existed).

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'release summary clause'`
Expected: FAIL — 1 failed: `expected [] to deeply equal [ 'shared/update-summary.ts' ]`; every other case skipped by the filter.

- [ ] **Step 3: Write `shared/update-summary.ts`**

```ts
// The one spelling of "what the nodes run" (design 2026-09-20 §13; plan W3 Task 3, D-3301).
//
// Two packages say the same clause: the server's release push ("On stable — fleet and server are on v0.0.7.")
// and the PWA's update banner ("v0.0.9 is out on stable — fleet and server are on v0.0.7."). Written twice it
// is two sentences to keep in step, so it lives here, in L0, and both import it; `single-definition.test.ts`
// holds the clause to this one file across the four TS roots.
//
// L0: this file imports NOTHING — not a type, not `node:*` — because the PWA bundles it. Its row type is
// STRUCTURAL (`role` and `version` as plain strings), so neither the server's `NodeRow` nor the wire's
// `NodeWire` leaks into L0: each caller maps its own row onto `SummaryRow` at the call site.

/** One node, as the summary reads it: `version` is a release tag, or `null` = unversioned (no stamp, an
 *  unreadable one, or a stamp that carries no tag). `role` is `NodeRole`'s word, or `null` = unknown. */
export interface SummaryRow { role: string | null; version: string | null }

/** How a node with no tag reads — the word `BuildLine` and `FleetHostBanner` already show. */
export const UNVERSIONED_WORD = 'unversioned';
/** How a side with no row at all reads (a fleet node never measured, a server row not yet written). */
export const MISSING_SIDE = '—';

/** The two sides of a fleet. `server` = the first row whose role is `server` or `both` (W2 Task 14's
 *  `derivedBuilds` picks its `own` side the same way); `fleet` = the first row whose role is `fleet`, else the
 *  server row itself when ITS role is `both` — one box that is both, local mode, where "the fleet" and "the
 *  server" are the same install. A row whose role is `null` or another word is on neither side. Generic, so a
 *  caller gets its own row objects back. */
export function versionSides<T extends { role: string | null }>(rows: readonly T[]): { fleet: T | null; server: T | null } {
  const server = rows.find((r) => r.role === 'server' || r.role === 'both') ?? null;
  const fleet = rows.find((r) => r.role === 'fleet') ?? (server !== null && server.role === 'both' ? server : null);
  return { fleet, server };
}

/** One side as text: its tag, `UNVERSIONED_WORD` when it has none, `MISSING_SIDE` when there is no row. */
export function sideVersion(row: SummaryRow | null): string {
  if (row === null) return MISSING_SIDE;
  return typeof row.version === 'string' ? row.version : UNVERSIONED_WORD;
}

/** `fleet and server are on v0.0.7` when BOTH sides are present and run the SAME TAG; otherwise each side
 *  named — `fleet v0.0.7 · server v0.0.9`, `fleet — · server v0.0.7`, `fleet unversioned · server v0.0.7`.
 *  Two unversioned sides do not "agree": nothing is known to be the same, so they are named one by one. */
export function versionsSummary(rows: readonly SummaryRow[]): string {
  const { fleet, server } = versionSides(rows);
  if (fleet !== null && server !== null && typeof fleet.version === 'string' && fleet.version === server.version) {
    return `fleet and server are on ${fleet.version}`;
  }
  return `fleet ${sideVersion(fleet)} · server ${sideVersion(server)}`;
}
```

- [ ] **Step 4: Run them green, and the PWA's type gate over `shared/`**

Run: `cd server && ./node_modules/.bin/vitest run test/update-summary.test.ts`
Expected: PASS — `Tests  9 passed (9)` (measured against this module and test file with vitest 4.1.10).

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'release summary clause'`
Expected: PASS — 1 passed.

Run: `cd pwa && npm run build` (foreground; `npm ci` first if `pwa/node_modules` is absent)
Expected: exit 0 — `pwa/tsconfig.json` includes `../shared`, so its strict flags now compile the new module (measured: the module is clean under `tsc --strict --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters --erasableSyntaxOnly --verbatimModuleSyntax`).

- [ ] **Step 5: Write the failing copy tests**

In `server/test/update-notify.test.ts` (Task 2's file), extend its one import from `'../src/update/notify.js'` IN PLACE. Task 2 wrote it as three lines; replace the middle one

```ts
  releaseToNotify, type NotifyInput, type NotifyNodeRow, type NotifyReleaseRow,
```

with

```ts
  RELEASE_PUSH_URL, releasePushCopy, releasePushTag, releaseToNotify, type NotifyInput, type NotifyNodeRow, type NotifyReleaseRow, type ReleaseNotification,
```

(Task 2 imports none of the four new names, so each is named once.) Then append after the file's last line (the closing `});` of Task 2's `describe('the ring …')`):

```ts

describe('the release push copy (plan W3 Task 3, design 2026-09-20 §13)', () => {
  const n: ReleaseNotification = { tag: 'v0.0.9', channel: 'stable', push: true };

  it('spells the title, body, collapse tag and url once', () => {
    expect(releasePushCopy(n, 'fleet and server are on v0.0.7')).toEqual({
      title: 'ccrc v0.0.9 is out',
      body: 'On stable — fleet and server are on v0.0.7. Tap to see what\'s new.',
      tag: 'release-v0.0.9',
      url: '/settings',
    });
  });

  it("carries the per-side summary verbatim, on the notification's own channel", () => {
    expect(releasePushCopy({ tag: 'v0.0.10', channel: 'dev', push: true }, 'fleet v0.0.7 · server v0.0.9').body)
      .toBe('On dev — fleet v0.0.7 · server v0.0.9. Tap to see what\'s new.');
  });

  it('the collapse tag is release-<tag>, spelled once, and the tap lands on /settings', () => {
    expect(releasePushTag('v0.0.10')).toBe('release-v0.0.10');
    expect(releasePushCopy(n, 'x').tag).toBe(releasePushTag(n.tag));
    expect(RELEASE_PUSH_URL).toBe('/settings');
  });
});
```

(The test file's literal `'fleet and server are on v0.0.7'` is outside the four TS roots `single-definition.test.ts` walks — `server/test` is not one of them — so it is not a second holder.)

- [ ] **Step 6: Run them red**

Run: `cd server && ./node_modules/.bin/vitest run test/update-notify.test.ts`
Expected: FAIL — `Tests  3 failed | 20 passed (23)`: exactly the three new cases, `TypeError: releasePushCopy is not a function` (twice) and `TypeError: releasePushTag is not a function`; Task 2's 20 cases still pass. (Measured on a copy of these three cases against a `notify.ts` without the copy: `Tests  3 failed (3)` with those three messages — vitest binds a missing named export to `undefined`, it does not refuse the import.)

- [ ] **Step 7: Append the copy to `server/src/update/notify.ts`**

After the file's last line (Task 2's `releaseToNotify`):

```ts

// ── The release push's copy (plan W3 Task 3; design 2026-09-20 §13) ──────────────────────────────────────
// Pure strings, beside the decision they announce. The summary clause is the CALLER's argument
// (`versionsSummary`, shared/update-summary.ts), so this file spells no part of it and imports nothing new.

/** Where the tap lands: the settings screen's release list (push-sw.js prefers a payload `url`, Task 4). */
export const RELEASE_PUSH_URL = '/settings';

/** The tray collapse key — the ONE spelling, as `mergedKey` is the one spelling of the merged tag
 *  (watch.ts:365-370). One tag, one notification: a repeat (which the persisted mark exists to prevent)
 *  would replace, never stack. */
export function releasePushTag(tag: string): string {
  return `release-${tag}`;
}

export interface ReleasePushCopy { title: string; body: string; tag: string; url: string }

/** title `ccrc <tag> is out`; body `On <channel> — <summary>. Tap to see what's new.`; the collapse tag;
 *  the url. `n.push` is not read: a mark-only decision builds no copy, and the caller never asks. */
export function releasePushCopy(n: ReleaseNotification, summary: string): ReleasePushCopy {
  return {
    title: `ccrc ${n.tag} is out`,
    body: `On ${n.channel} — ${summary}. Tap to see what's new.`,
    tag: releasePushTag(n.tag),
    url: RELEASE_PUSH_URL,
  };
}
```

`notify.ts` stays L1: no `fs`, no store, no push, and still only Task 2's imports (`UPDATE_RING_FILES` already names it, Task 2).

- [ ] **Step 8: Run them green**

Run: `cd server && ./node_modules/.bin/vitest run test/update-notify.test.ts test/single-definition.test.ts`
Expected: PASS — `update-notify.test.ts` `23 passed (23)` (Task 2's 20 plus 3); `single-definition.test.ts` passes whole, the update-ring describe included (the appended copy adds no import to `notify.ts`) and the release-summary case still `['shared/update-summary.ts']` (the copy spells no part of the clause).

- [ ] **Step 9: Write the failing watcher tests in `server/test/push-copy.test.ts`**

(a) Imports, in place. Replace `:1`

```ts
import { describe, it, expect, vi } from 'vitest';
```

with

```ts
import { afterEach, describe, it, expect, vi } from 'vitest';
```

replace `:17`

```ts
import { PRESENCE_REFRESH_MS, PRESENCE_TTL_MS } from '../../shared/api.js';
```

with

```ts
import { FLEET_SCOPE, PRESENCE_REFRESH_MS, PRESENCE_TTL_MS, type NodeRole, type UpdateChannel } from '../../shared/api.js';
```

replace `:19`

```ts
import { CoordStore } from '../src/coord/store.js';
```

with

```ts
import { CoordStore, type NodeMeasurement, type ReleaseListingRow, type UpdateIntentPatch } from '../src/coord/store.js';
```

and add directly after `:20` (`import { okRuns } from './coordReadHelpers.js';`):

```ts
import type { CcrcConfig } from '../src/config.js';
import type { CataloguePoller } from '../src/update/catalogue.js';
import { FLEET_LABEL, SERVER_LABEL } from '../src/update/inventory.js';
import { UpdateIntentLog, defaultUpdateIntentLogPath } from '../src/coord/updateintentlog.js';
import { NODE_FILES } from '../../shared/agent-protocol.js';
```

(b) The factory. Replace the whole `watcher()` function — from its docstring's first line `/**` (`:106`, after `oneQuestion`'s closing `});` at `:104` and a blank line) through its closing `}` (`:157`), i.e. the text that begins ` * A \`FleetWatcher\` over a throwaway fixture home carrying one session per` and ends with the `markBusy` arrow and `  };\n}` — with:

```ts
/**
 * A `FleetWatcher` over a throwaway fixture home carrying one session per
 * `"<project>/<id>"` spec, all starting `busy` — so the first (priming)
 * `tick()` records `prevStatus: busy` for every one of them and `markIdle`
 * can then drive a genuine busy→idle edge on the next `tick()`.
 */
function watcher(opts: {
  /** Plan W3 Task 3: optional — omitted, the watcher has NO push service,
   *  as a box with no VAPID keys runs (`index.ts` builds `push` only then). */
  push?: { notify: (p: PushPayload) => Promise<void> };
  presence?: Presence;
  notifyLog?: NotifyLog;
  /** Task 10: when true, a real `CoordStore` (over this fixture home's own
   *  `.ccrc/coord.db`) is wired in and returned — the mail/run notify lanes
   *  and the durable feed archive both need one to have anything to read. */
  coord?: boolean;
  sessions: string[];
  pane?: string;
  /** Blocking review finding 2: lets a test degrade a registry field
   *  mid-fixture (a row LISTED but unreadable), the same shape every other
   *  registry-ladder test in this tree uses. */
  io?: FleetIO;
  /** Plan W3 Task 3: fields laid over `testDeps`' config — `{ role: 'fleet' }`
   *  is a fleet-role process, which owns no push subscriptions. */
  cfg?: Partial<CcrcConfig>;
  /** Plan W3 Task 3: the catalogue lane's poller (W2 Task 10's `Deps.catalogue`). */
  catalogue?: CataloguePoller;
  /** Plan W3 Task 3: an EXISTING fixture home. A second watcher over the same
   *  home opens a second connection to the same `coord.db` — a restart. */
  home?: string;
}): { tick: () => Promise<void>; markIdle: (id: string) => void; markBusy: (id: string) => void; home: string; coord?: CoordStore; w: FleetWatcher } {
  const home = opts.home ?? mkTmp('ccrc-');
  const info = seedSessions(home, opts.sessions);
  const coord = opts.coord ? new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db'))) : undefined;
  const base = testDeps(home, runnerFor(info, opts.pane));
  const deps = {
    ...base,
    ...(opts.cfg ? { cfg: { ...base.cfg, ...opts.cfg } } : {}),
    ...(opts.push ? { push: opts.push as never } : {}),
    presence: opts.presence,
    notifyLog: opts.notifyLog,
    coord,
    ...(opts.io ? { io: opts.io } : {}),
    ...(opts.catalogue ? { catalogue: opts.catalogue } : {}),
  };
  // The state cache stays inside the fixture home: without the fourth
  // argument the constructor falls back to `defaultCachePath()`, the LIVE
  // ~/.ccrc — never read by a local-mode tick, but a fixture has no business
  // naming it.
  const w = new FleetWatcher(deps, new Bus(), 10_000, path.join(home, 'state-cache.json'));
  return {
    home,
    coord,
    w,
    tick: () => w.tick(),
    markIdle: (id: string) => {
      const s = info.get(id);
      if (!s) throw new Error(`push-copy.test.ts: no seeded session "${id}"`);
      writeLiveStatus(s, id, 'idle');
    },
    // The mirror of `markIdle`, for a test that needs to drive a session back
    // to work and then finish it again — a REAL busy→idle edge, after some
    // earlier tick has already been asked not to invent one.
    markBusy: (id: string) => {
      const s = info.get(id);
      if (!s) throw new Error(`push-copy.test.ts: no seeded session "${id}"`);
      writeLiveStatus(s, id, 'busy');
    },
  };
}
```

Every existing caller passes `push` (so the spread always carries it, as the old `push: opts.push as never` did) and none of the three new inputs, and never reads `w`, so its behaviour is unchanged.

(c) Append after the file's last line (`:1049`, the closing `});` of the `describe` that ends with "a break on the very first (priming) tick …"):

```ts

// ── Plan W3 Task 3: the release push (design 2026-09-20 §13) ────────────────────────────────────────────────
// A fleet-level push with no session (D-3296): decided by the pure `releaseToNotify`
// (Task 2), marked in `releases.notifiedAt` BEFORE the send is started (D-3295), and
// sent straight to `push.notify` — never through `pushOne`, whose presence gate and feed record are about a
// session. Each case calls the watcher's public `pushRelease` directly unless it is about a lane's wiring.
describe('the release push — once per tag, across restarts, sessionless (design 2026-09-20 §13)', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  const T = 1_790_000_000_000;
  const listed = (tag: string, channel: UpdateChannel = 'stable'): ReleaseListingRow => ({
    tag, channel, publishedAt: T, commitSha: null, tarballUrl: `https://example.invalid/download/${tag}/ccrc-${tag}.tar.gz`,
    bundleListed: true, notes: null, draft: false,
  });
  /** A measured node row, label-keyed (a node with no node-id yet — the store admits it, W2 Task 5). */
  const measured = (label: string, role: NodeRole, currentVersion: string | null): NodeMeasurement => ({
    nodeId: label, role, label, currentVersion, currentSha: 'a'.repeat(40), currentRef: 'main',
    currentBuiltAt: '2026-09-22T00:00:00Z', currentDirty: false, stampRead: 'ok', installState: 'complete',
    provenance: 'verified', caps: ['verify', 'node-id', 'floor'], agentOps: role === 'fleet' ? [] : null,
    highestVersion: currentVersion, previousVersion: null, os: 'linux', measuredAt: T, report: null,
  });
  const recorder = (): { sent: PushPayload[]; push: { notify: (p: PushPayload) => Promise<void> } } => {
    const sent: PushPayload[] = [];
    return { sent, push: { notify: async (p: PushPayload) => { sent.push(p); } } };
  };
  /** The catalogue plus a remote-mode fleet's two measured nodes. */
  const seed = (coord: CoordStore, o: { releases: ReleaseListingRow[]; server: string | null; fleet: string | null }): void => {
    expect(coord.applyReleaseListing(o.releases, T, 'complete')).toMatchObject({ ok: true });
    expect(coord.upsertNodeMeasurement(measured(SERVER_LABEL, 'server', o.server)).ok).toBe(true);
    expect(coord.upsertNodeMeasurement(measured(FLEET_LABEL, 'fleet', o.fleet)).ok).toBe(true);
  };
  /** The fleet row's intent, through the store's one intent writer and its journal. */
  const intent = (w: { home: string; coord?: CoordStore }, patch: UpdateIntentPatch): void => {
    const log = new UpdateIntentLog(defaultUpdateIntentLogPath(path.join(w.home, '.ccrc')));
    expect(w.coord!.setIntent(FLEET_SCOPE, patch, log, T)).toMatchObject({ ok: true });
  };
  const notifiedAt = (coord: CoordStore, tag: string): number | null | undefined =>
    coord.releases().find((r) => r.tag === tag)?.notifiedAt;
  const COPY_V009 = {
    title: 'ccrc v0.0.9 is out',
    body: 'On stable — fleet and server are on v0.0.7. Tap to see what\'s new.',
    tag: 'release-v0.0.9',
    url: '/settings',
  };

  it('sends the pinned copy — title, body, collapse tag and the /settings url, with no session', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9'), listed('v0.0.7')], server: 'v0.0.7', fleet: 'v0.0.7' });
    const outcome = w.w.pushRelease(T);
    expect(sent).toEqual([COPY_V009]);
    expect(Object.keys(sent[0]!).sort()).toEqual(['body', 'tag', 'title', 'url']);   // no sessionId, no actions
    expect(sent[0]!.sessionId).toBeUndefined();
    expect(sent[0]!.actions).toBeUndefined();
    expect(outcome).toEqual({ did: 'pushed', tag: 'v0.0.9', payload: sent[0] });
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBe(T);
    expect(notifiedAt(w.coord!, 'v0.0.7')).toBeNull();   // only the newest is ever announced
  });

  it('names each side when the nodes disagree — On dev — fleet v0.0.7 · server v0.0.9', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.10', 'dev'), listed('v0.0.9')], server: 'v0.0.9', fleet: 'v0.0.7' });
    intent(w, { channel: 'dev' });
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.10' });   // semver: v0.0.10 > v0.0.9
    expect(sent.map((p) => [p.title, p.body, p.tag])).toEqual([
      ['ccrc v0.0.10 is out', 'On dev — fleet v0.0.7 · server v0.0.9. Tap to see what\'s new.', 'release-v0.0.10'],
    ]);
  });

  it('sends once per tag: a second decision after notifiedAt sends nothing and keeps the first mark', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    expect(w.w.pushRelease(T + 60_000)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(w.w.pushRelease(T + 120_000)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(sent).toHaveLength(1);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBe(T);
  });

  it('sends once per tag across a restart: a NEW watcher over the same coord.db sends nothing', () => {
    const first = recorder();
    const a = watcher({ push: first.push, coord: true, sessions: [] });
    seed(a.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(a.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    expect(first.sent).toHaveLength(1);

    const second = recorder();
    a.coord!.db.close();                                // the first process is gone: nothing below reads through its handle
    const b = watcher({ push: second.push, coord: true, sessions: [], home: a.home });
    expect(notifiedAt(b.coord!, 'v0.0.9')).toBe(T);     // a second connection, from disk, reads the committed mark
    expect(b.w.pushRelease(T + 60_000)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(second.sent).toEqual([]);
  });

  it("notify: 'stable' skips a newer dev tag and announces the stable one, on stable", () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9', 'dev'), listed('v0.0.8')], server: 'v0.0.7', fleet: 'v0.0.7' });
    intent(w, { channel: 'dev', notify: 'stable' });
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.8' });
    expect(sent.map((p) => p.tag)).toEqual(['release-v0.0.8']);
    expect(sent[0]!.body).toBe('On stable — fleet and server are on v0.0.7. Tap to see what\'s new.');
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();
  });

  it("notify: 'off' sends nothing and marks nothing", () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    intent(w, { notify: 'off' });
    expect(w.w.pushRelease(T)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(sent).toEqual([]);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();
  });

  // D-3294: a tag every measured node already runs is marked, not announced.
  it('a fleet already on the newest tag is marked with no push, and the next tag listed afterwards is pushed', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.9', fleet: 'v0.0.9' });
    expect(w.w.pushRelease(T)).toEqual({ did: 'marked', tag: 'v0.0.9' });
    expect(sent).toEqual([]);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBe(T);

    expect(w.coord!.applyReleaseListing([listed('v0.0.10'), listed('v0.0.9')], T + 1, 'complete')).toMatchObject({ ok: true });
    expect(w.w.pushRelease(T + 1)).toMatchObject({ did: 'pushed', tag: 'v0.0.10' });
    expect(sent.map((p) => p.title)).toEqual(['ccrc v0.0.10 is out']);
  });

  // D-3295: the mark is COMMITTED — visible to another connection — before the send starts.
  it('commits the mark before notify is called: a second connection reads notifiedAt inside the send', () => {
    let reader: CoordStore | null = null;
    const seen: (number | null | undefined)[] = [];
    const push = { notify: async (_p: PushPayload) => { seen.push(reader === null ? undefined : notifiedAt(reader, 'v0.0.9')); } };
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    reader = new CoordStore(openCoordDb(path.join(w.home, '.ccrc', 'coord.db')));
    expect(notifiedAt(reader, 'v0.0.9')).toBeNull();     // control: nothing is marked before the decision
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed' });
    expect(seen).toEqual([T]);
  });

  it('a send that rejects is not retried — at most once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const push = { notify: async (_p: PushPayload) => { calls += 1; throw new Error('endpoint gone'); } };
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    await vi.waitFor(() => expect(warn.mock.calls.some(([l]) =>
      String(l).includes('release push for v0.0.9 did not send'))).toBe(true));
    expect(w.w.pushRelease(T + 60_000)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(calls).toBe(1);
  });

  it('a mark that loses sends nothing — another writer marked the tag first', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    vi.spyOn(w.coord!, 'markReleaseNotified').mockReturnValue({ ok: false, why: 'already-notified', notifiedAt: T - 1 });
    expect(w.w.pushRelease(T)).toEqual({ did: 'refused', tag: 'v0.0.9', why: 'already-notified' });
    expect(sent).toEqual([]);
  });

  it('a store that throws is a failed decision — warned once per reason, nothing sent, never thrown to the lane', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    w.coord!.db.close();                     // node:sqlite now throws synchronously on every read
    const a = w.w.pushRelease(T);
    const b = w.w.pushRelease(T + 60_000);
    expect(a).toMatchObject({ did: 'failed' });
    expect(b).toEqual(a);
    expect(sent).toEqual([]);
    expect(warn.mock.calls.filter(([l]) => String(l).includes('the release push was not decided'))).toHaveLength(1);
  });

  it("a fleet-role process neither sends nor marks — push subscriptions are the server box's", () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [], cfg: { role: 'fleet' } });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(w.w.pushRelease(T)).toEqual({ did: 'skipped', why: 'not-server-role' });
    expect(sent).toEqual([]);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();
  });

  it('no coordination database: nothing to decide', () => {
    const { sent, push } = recorder();
    const w = watcher({ push, sessions: [] });
    expect(w.w.pushRelease(T)).toEqual({ did: 'skipped', why: 'no-coord' });
    expect(sent).toEqual([]);
  });

  it('no push service (no VAPID keys) decides and marks nothing — a sender configured later still announces the tag', () => {
    const w = watcher({ coord: true, sessions: [] });   // no `push`: the box `index.ts` builds without VAPID keys
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(w.w.pushRelease(T)).toEqual({ did: 'skipped', why: 'no-push-service' });
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();   // not used up: nothing was sent
    const { sent, push } = recorder();
    const b = watcher({ push, coord: true, sessions: [], home: w.home });   // the restart after VAPID keys are configured
    expect(b.w.pushRelease(T + 60_000)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    expect(sent.map((p) => p.tag)).toEqual(['release-v0.0.9']);
  });

  it('a visible session does not suppress it — the release push has no session to be looking at', () => {
    const { sent, push } = recorder();
    const presence = new Presence();
    presence.setVisible(Symbol('t'), 'cc-a');
    const w = watcher({ push, presence, coord: true, sessions: ['ccrc-pwa/cc-a'] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(presence.isVisible('cc-a')).toBe(true);        // control: the gate WOULD suppress a pushOne about cc-a
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed', tag: 'v0.0.9' });
    expect(sent).toHaveLength(1);
  });

  it('leaves no feed row and no ring record — it is a push, not a NotifyEvent', async () => {
    const { sent, push } = recorder();
    const log = new NotifyLog(path.join(mkTmp('push-release-log-'), 'n.json'));
    await log.load();
    const w = watcher({ push, notifyLog: log, coord: true, sessions: [] });
    seed(w.coord!, { releases: [listed('v0.0.9')], server: 'v0.0.7', fleet: 'v0.0.7' });
    expect(w.w.pushRelease(T)).toMatchObject({ did: 'pushed' });
    expect(sent).toHaveLength(1);
    expect(log.seq).toBe(0);
    expect(w.coord!.feedEvents(10)).toEqual([]);
  });

  it('is wired through the inventory lane: inventoryNow() on a local-mode server pushes once the sweep has measured the box', async () => {
    const { sent, push } = recorder();
    const w = watcher({ push, coord: true, sessions: [] });
    expect(w.coord!.applyReleaseListing([listed('v0.0.9')], T, 'complete')).toMatchObject({ ok: true });
    writeFileSync(path.join(w.home, '.ccrc', NODE_FILES.stamp),
      `${JSON.stringify({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-22T00:00:00Z', dirty: false, version: 'v0.0.7' })}\n`);
    // D-3300: before the first sweep no node is measured, so nothing is decided.
    expect(w.w.pushRelease(Date.now())).toEqual({ did: 'skipped', why: 'nothing-to-notify' });
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();
    await w.w.inventoryNow();
    expect(sent).toEqual([COPY_V009]);   // local mode: the one `both` row is both sides
  });

  /** A catalogue double whose `poll` lists `v0.0.9` into the watcher's own store, as W2's poller writes. */
  const listingPoller = (store: () => CoordStore): CataloguePoller => ({
    poll: async (now: number) => {
      store().applyReleaseListing([listed('v0.0.9')], now, 'complete');
      return { lastOkAt: now, lastError: null };
    },
    state: () => ({ lastOkAt: null, lastError: null }),
    lastRequestAt: () => null,
  });
  const writeStamp = (home: string, version: string): void => {
    writeFileSync(path.join(home, '.ccrc', NODE_FILES.stamp),
      `${JSON.stringify({ sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-22T00:00:00Z', dirty: false, version })}\n`);
  };

  it('is wired through the catalogue lane: once this process has swept, the poll that lists a tag announces it', async () => {
    const { sent, push } = recorder();
    let store: CoordStore | null = null;
    const w = watcher({ push, coord: true, sessions: [], catalogue: listingPoller(() => store!) });
    store = w.coord!;
    writeStamp(w.home, 'v0.0.7');
    expect(w.w.pushRelease(T)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });   // control: nothing listed yet
    // This process's first inventory run: it measures the box (v0.0.7) and, with nothing listed, decides nothing.
    await w.w.inventoryNow();
    expect(sent).toEqual([]);
    vi.spyOn(w.w, 'inventoryNow').mockResolvedValue([]);   // the inventory lane stays out: this case is the catalogue's
    await w.tick();
    await vi.waitFor(() => expect(sent.map((p) => p.tag)).toEqual(['release-v0.0.9']));
    expect(sent[0]!.body).toBe('On stable — fleet and server are on v0.0.7. Tap to see what\'s new.');
  });

  // D-3314: until this process's first inventory run rewrites them, the nodes
  // rows are the PREVIOUS process's — after a server-box update, still at the version the update replaced.
  it("the catalogue lane waits for this process's first inventory run — a row from before the restart is never decided on", async () => {
    const { sent, push } = recorder();
    let store: CoordStore | null = null;
    const w = watcher({ push, coord: true, sessions: [], catalogue: listingPoller(() => store!) });
    store = w.coord!;
    // The previous process's row: this box on v0.0.7, measured before the update that placed v0.0.9 and restarted it.
    expect(w.coord!.upsertNodeMeasurement(measured(SERVER_LABEL, 'both', 'v0.0.7')).ok).toBe(true);
    writeStamp(w.home, 'v0.0.9');                            // this process's tree, which its first run will read
    expect(w.w.pushRelease(T)).toEqual({ did: 'skipped', why: 'nothing-to-notify' });   // control: nothing listed yet
    const inventory = vi.spyOn(w.w, 'inventoryNow').mockResolvedValue([]);   // the first run has not finished
    const afterPoll = vi.spyOn(w.w, 'pushReleaseAfterPoll');
    await w.tick();
    await vi.waitFor(() => expect(afterPoll).toHaveBeenCalledTimes(1));
    expect(afterPoll.mock.results[0]!.value).toEqual({ did: 'skipped', why: 'not-yet-swept' });
    expect(w.coord!.releases().map((r) => r.tag)).toEqual(['v0.0.9']);   // control: the poll DID list the tag
    expect(sent).toEqual([]);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toBeNull();
    // The first run finishes: it measures v0.0.9 (the same label-keyed row, rewritten) and decides — marked, no push.
    inventory.mockRestore();
    await w.w.inventoryNow();
    expect(sent).toEqual([]);
    expect(notifiedAt(w.coord!, 'v0.0.9')).toEqual(expect.any(Number));
  });
});
```

(d) `server/test/update-routes.test.ts` (W2 Task 13's file) — the *Check now* path. Add directly after its `import type { CataloguePoller } from '../src/update/catalogue.js';` line:

```ts
import type { PushPayload } from '../src/push.js';
```

In `open()`, widen the options type `o: { auth?: boolean; watcher?: boolean; catalogue?: CataloguePoller; remote?: boolean } = {}` to

```ts
  o: { auth?: boolean; watcher?: boolean; catalogue?: CataloguePoller; remote?: boolean; push?: { notify: (p: PushPayload) => Promise<void> } } = {},
```

and in its `deps` literal, directly after `...(o.catalogue ? { catalogue: o.catalogue } : {}),`:

```ts
    ...(o.push ? { push: o.push as never } : {}),
```

(No existing caller passes `push`, so every W2 case builds the same `deps` as before.) Then append after the file's last line:

```ts

describe('POST /api/updates/refresh announces what its poll listed (plan W3 Task 3)', () => {
  // The route polls `deps.catalogue` itself, outside `tick()`: without its own call site a release found by
  // *Check now* would wait up to a minute for the next inventory run to be announced.
  it('a refresh whose poll lists a newer tag sends ONE release push, from the request itself', async () => {
    const sent: PushPayload[] = [];
    const p = scriptedPoller();
    let store: CoordStore | null = null;
    const poller: CataloguePoller = { ...p.poller, poll: async (now) => { catalogue(store!); return p.poller.poll(now); } };
    const f = await open({ watcher: true, catalogue: poller, push: { notify: async (x) => { sent.push(x); } } });
    store = f.coord;
    // This process's first inventory run — the GET's on-demand sweep — measures the box (unversioned: the fixture
    // home has no stamp). Until one run has finished, the catalogue side decides nothing
    // (D-3314).
    expect((await f.app.inject({ method: 'GET', url: '/api/updates' })).statusCode).toBe(200);
    expect(f.coord.releases()).toEqual([]);   // control: nothing is listed before the refresh
    expect(sent).toEqual([]);
    const r = await post(f.app, '/api/updates/refresh', {});
    expect(r.statusCode, r.body).toBe(200);
    expect(sent.map((x) => [x.title, x.tag, x.url])).toEqual([['ccrc v0.0.10 is out', 'release-v0.0.10', '/settings']]);
    expect(f.coord.releases().find((x) => x.tag === 'v0.0.10')?.notifiedAt).toEqual(expect.any(Number));
  });
});
```

(`LISTING`'s stable `v0.0.10` is the newest eligible on the fleet row's default `stable` channel; the dev `v0.0.11` is not on it. The unversioned box row makes the decision `push: true`.)

- [ ] **Step 10: Run them red**

Run: `cd server && ./node_modules/.bin/vitest run test/push-copy.test.ts` (foreground)
Expected: FAIL — `Tests  19 failed | 37 passed (56)`. Every new case fails on its first `pushRelease` call, `TypeError: w.w.pushRelease is not a function` (or `a.w.pushRelease`) — the catalogue, stale-row and inventory cases included, because each calls `pushRelease` as its control before driving a lane. The 37 existing cases pass: the factory's new inputs are optional, `push` is still spread whenever given, and its new `w` is unread by them. Do not run `typecheck-tests.test.ts` yet — `PushPayload` has no `url` until Step 11, so the file does not compile.

Run: `cd server && ./node_modules/.bin/vitest run test/update-routes.test.ts -t 'announces what its poll listed'`
Expected: FAIL — 1 failed: `expected [] to deeply equal [ [ 'ccrc v0.0.10 is out', 'release-v0.0.10', '/settings' ] ]` (the route does not call the watcher yet); every other case skipped by the filter.

- [ ] **Step 11: Implement — `push.ts`, then `watch.ts`, then the refresh route**

(a) `server/src/push.ts` — in `PushPayload`, directly after `tag?: string; // collapse key so repeats of the same event replace, not stack` (`:19`):

```ts
  url?: string; // a same-origin path the SW opens on tap, ahead of /s/<sessionId>
```

(b) `server/src/watch.ts` — imports. Replace the one-line value import (`:34`, keep the three-line comment above it)

```ts
import { LEDGER_STALE_MS, MAIL_MAX_ATTEMPTS, UNCHECKED_PR, lifecycleIsDead, sessionLifecycle } from '../../shared/api.js';
```

with (still ONE line, as that comment requires)

```ts
import { FLEET_SCOPE, LEDGER_STALE_MS, MAIL_MAX_ATTEMPTS, UNCHECKED_PR, lifecycleIsDead, sessionLifecycle } from '../../shared/api.js';
```

replace `:57`

```ts
import { MAIL_REPLAY_CEILING_ERROR, toRunSummary, type CoordStore, type AskRow } from './coord/store.js';
```

with

```ts
import { MAIL_REPLAY_CEILING_ERROR, toRunSummary, type CoordStore, type AskRow, type MarkReleaseNotifiedResult } from './coord/store.js';
```

and directly after W2 Task 12's `import { resolveAndProject, type ProjectionOutcome } from './update/project.js';`:

```ts
import { releasePushCopy, releaseToNotify, type ReleaseNotification } from './update/notify.js';
import { versionsSummary } from '../../shared/update-summary.js';
```

(c) Between `mergedKey` (`const mergedKey = (id: string, number: number | null): string => …;`, `:370` at `d759c914`) and `export class FleetWatcher {` (`:372` at `d759c914`; W2's inserts above move both numbers — match the text) — after the blank line that follows `mergedKey`:

```ts
/** What one `FleetWatcher.pushRelease` call did (design 2026-09-20 §13; plan W3 Task 3). Each arm is a fact
 *  a caller or a test tells apart: nothing to decide; decided and marked with no push, every measured node
 *  already running the tag (D-3294); pushed; the mark lost to another writer, so nothing
 *  was sent; or a store read or write threw, so nothing was marked or sent. */
export type ReleasePushOutcome =
  | { did: 'skipped'; why: 'no-coord' | 'not-server-role' | 'nothing-to-notify' }
  | { did: 'marked'; tag: string }
  | { did: 'pushed'; tag: string; payload: PushPayload }
  | { did: 'refused'; tag: string; why: Extract<MarkReleaseNotifiedResult, { ok: false }>['why'] }
  | { did: 'failed'; detail: string };

```

(d) The field, directly after W2 Task 12's `  private lastProjectionWhy: string | null = null;`:

```ts
  /** Plan W3 Task 3: the last reason a release-push decision failed, so a coord.db that cannot be read
   *  warns once per change of reason on the inventory lane's minute beat (`lastProjectionWhy`'s idiom). */
  private lastReleasePushFailure: string | null = null;
  /** Plan W3 Task 3 (D-3314): true once THIS process has finished one
   *  inventory run. Until then the `nodes` rows are the previous process's, so the catalogue side
   *  (`pushReleaseAfterPoll`) decides nothing. Set by `sweepThenProject`; never cleared. */
  private inventorySwept = false;
```

(e) The two methods, directly after W2 Task 12's `private async sweepThenProject(…)` (after its closing brace):

```ts

  /**
   * The release push (design 2026-09-20 §13; plan W3 Task 3): ONE Web Push per release tag, across restarts.
   * Called at the end of every inventory run (`sweepThenProject`) and, through `pushReleaseAfterPoll`, after
   * every catalogue poll — `tick()`'s catalogue gate and `POST /api/updates/refresh` (`update/routes.ts`), the
   * *Check now* poll, which runs outside `tick()`. PUBLIC for those callers and for the tests — the
   * `inventoryNow()` precedent.
   *
   * SYNCHRONOUS, and that is the dedup. The decision (`releaseToNotify`, pure) and the mark
   * (`markReleaseNotified`, whose `WHERE notifiedAt IS NULL` makes a second marker lose) run with no `await`
   * between them, so nothing else in this process — the other lane, a second tick — can interleave, and a
   * restarted process reads the committed `notifiedAt`. `mergedNotified`'s in-memory `Set` is the shape this
   * deliberately is not: a latch that forgets on restart repeats the push.
   *
   * The send starts only AFTER the mark committed, is `void`ed and is never retried
   * (D-3295): at most once, because a repeated "vX is out" is the noise the persisted
   * mark exists to stop, and a missed one is still shown by the banner and the settings screen.
   *
   * Sessionless (D-3296): no `sessionId`, no presence gate, no `NotifyLog` or feed record —
   * `pushOne` is about a session and this is about the fleet. A server-role process only: the push
   * subscriptions are this box's disk (`push.ts`'s header), and the notify mode is the fleet row's alone.
   * With no push service (no VAPID keys — `index.ts` builds `push` only then) it decides and marks NOTHING:
   * a mark with no sender would answer `pushed` for a push nobody sent and use the tag up for good, so a
   * sender configured later could never announce it.
   * Never throws: a store failure is the `failed` arm, so no caller's `.catch` (a lane's, or the refresh route's
   * request) is ever what stops it.
   */
  pushRelease(now: number): ReleasePushOutcome {
    const coord = this.deps.coord;
    if (coord === undefined) return { did: 'skipped', why: 'no-coord' };
    const role = this.deps.cfg.role;
    if (role !== 'server' && role !== 'both') return { did: 'skipped', why: 'not-server-role' };
    const sender = this.deps.push;
    if (sender === undefined) return { did: 'skipped', why: 'no-push-service' };
    let n: ReleaseNotification | null;
    let marked: MarkReleaseNotifiedResult;
    let summary: string;
    try {
      const fleetIntent = coord.intentFor(FLEET_SCOPE);
      const nodes = coord.nodes();
      n = releaseToNotify({ fleetIntent, releases: coord.releases(), nodes });
      if (n === null) {
        this.lastReleasePushFailure = null;
        return { did: 'skipped', why: 'nothing-to-notify' };
      }
      marked = coord.markReleaseNotified(n.tag, now);
      summary = versionsSummary(nodes.filter((r) => r.measuredAt !== null).map((r) => ({ role: r.role, version: r.currentVersion })));
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      if (detail !== this.lastReleasePushFailure) console.warn(`update: the release push was not decided (${detail}) — nothing was marked or sent`);
      this.lastReleasePushFailure = detail;
      return { did: 'failed', detail };
    }
    this.lastReleasePushFailure = null;
    if (!marked.ok) return { did: 'refused', tag: n.tag, why: marked.why };
    if (!n.push) return { did: 'marked', tag: n.tag };
    const copy = releasePushCopy(n, summary);
    const payload: PushPayload = { title: copy.title, body: copy.body, tag: copy.tag, url: copy.url };
    const tag = n.tag;
    const sending = sender.notify(payload);
    void sending.catch((e: unknown) => {
      console.warn(`update: the release push for ${tag} did not send (${e instanceof Error ? e.message : String(e)}) — it is not retried; the banner and the settings screen still show the release`);
    });
    return { did: 'pushed', tag, payload };
  }

  /**
   * The catalogue side's entry (plan W3 Task 3): `tick()`'s catalogue gate and `POST /api/updates/refresh`
   * call this, never `pushRelease` directly. It decides only once THIS process has finished one inventory run
   * (D-3314). Both lanes fire unawaited on the first tick after a start, and
   * until the first sweep rewrites them the `nodes` rows are the previous process's. After a server-box update
   * they still carry the version the update replaced, so a poll that resolves first would push "vX is out" to
   * a fleet already on vX. The inventory run's own `pushRelease` call makes that first decision instead.
   */
  pushReleaseAfterPoll(now: number): ReleasePushOutcome {
    if (!this.inventorySwept) return { did: 'skipped', why: 'not-yet-swept' };
    return this.pushRelease(now);
  }
```

(TypeScript's definite-assignment analysis treats `n`, `marked` and `summary` as assigned after the `try` because every path out of the `catch` returns — measured with this repo's `tsc` under `--strict` on the same shape. `sender` is a `const` narrowed by its `undefined` return, so the narrowing holds across the `try`.)

(f) Call site (a), the catalogue lane — in W2 Task 10's gate at the top of `tick()`'s `try`, replace

```ts
        void this.deps.catalogue.poll(Date.now()).catch(() => { /* one bad poll must not kill the tick */ });
```

with

```ts
        // Plan W3 Task 3: a poll that listed a new tag is decided on the poll's own answer, not a minute later
        // on the inventory lane — once this process has swept (D-3314).
        // `pushReleaseAfterPoll` is synchronous and never throws, so the `.catch` still covers the poll alone.
        void this.deps.catalogue.poll(Date.now()).then(() => { this.pushReleaseAfterPoll(Date.now()); }).catch(() => { /* one bad poll must not kill the tick */ });
```

(g) Call site (b), the inventory lane — inside `sweepThenProject`, replace

```ts
    this.lastProjectionWhy = why;
    return outcomes;
```

with

```ts
    this.lastProjectionWhy = why;
    // Plan W3 Task 3: the inventory run MEASURES what the nodes run, so it is where a release every node
    // already runs is marked instead of pushed (D-3294), where the first release after a
    // fresh install is decided at all (D-3300), and what opens the catalogue
    // side's decisions in this process (D-3314).
    this.inventorySwept = true;
    this.pushRelease(now);
    return outcomes;
```

(h) The third call site, `server/src/update/routes.ts` — in the `app.post('/api/updates/refresh', …)` handler, replace

```ts
    const state: CatalogueState = await deps.catalogue.poll(now);
    await reproject(req);
    return state;
```

with

```ts
    const state: CatalogueState = await deps.catalogue.poll(now);
    await reproject(req);
    // Plan W3 Task 3: *Check now* polls here, outside `tick()`, so a release this poll listed is decided in this
    // request rather than a minute later on the inventory run. Synchronous and never throws; the answer is the
    // catalogue state whatever it decides (with no watcher — a test's `open()` — there is nothing to decide).
    watcher?.pushReleaseAfterPoll(Date.now());
    return state;
```

Check the call sites: `grep -n 'this.pushRelease(' server/src/watch.ts` — Expected: exactly two hits, `sweepThenProject`'s and `pushReleaseAfterPoll`'s `return this.pushRelease(now);` (the docstrings name it without `this.`). `grep -n 'this.pushReleaseAfterPoll(' server/src/watch.ts` — Expected: one hit, the catalogue gate's. `grep -n 'pushReleaseAfterPoll(' server/src/update/routes.ts` — Expected: one hit, the refresh handler's.

- [ ] **Step 12: Run green**

Run: `cd server && ./node_modules/.bin/vitest run test/push-copy.test.ts test/update-notify.test.ts test/update-summary.test.ts test/single-definition.test.ts test/update-routes.test.ts` (foreground)
Expected: PASS — `push-copy.test.ts` `56 passed (56)`; `update-routes.test.ts` W2's count plus one; `update-notify.test.ts` `23 passed (23)`; `update-summary.test.ts` `9 passed (9)`; `single-definition.test.ts` every case.

Run: `cd server && ./node_modules/.bin/vitest run test/update-catalogue.test.ts test/update-inventory.test.ts test/update-projection.test.ts test/caps-refresh.test.ts`
Expected: PASS, every case, counts unchanged from W2. The watch.ts call sites now run inside lanes these files drive (the catalogue gate's continuation, the inventory run's last statement). None of their watchers wires `push`, so every decision there answers `no-push-service` and marks nothing, and no W2 case reads `notifiedAt` through a watcher. (W2's `update-routes.test.ts` cases ran in the command above: none passes `push`, and its refresh cases build no watcher, so the handler's new `watcher?.` call does nothing there.)

Run: `cd server && ./node_modules/.bin/vitest run test/session-hook.test.ts test/topology-clean.test.ts test/typecheck-tests.test.ts`
Expected: PASS — `session-hook.test.ts`'s citation audit is unmoved (the single-definition edit is an append, R13); `topology-clean.test.ts` scans the two new files (`shared/update-summary.ts`, `server/test/update-summary.test.ts`) and the push-copy fixture's `https://example.invalid/download/<tag>/ccrc-<tag>.tar.gz` tarball URL — the reserved `.invalid` TLD, the shape W2 Task 4's and this wave's Task 1's store tests already use; `typecheck-tests.test.ts` compiles the new cases against `PushPayload.url` and the factory's new inputs. `session-hook` and `typecheck-tests` are named load flakes: a red there is re-run in isolation before it is read.

Run: `cd server && npm run build`
Expected: exit 0 (`tsc` over `src/**` and `../shared/**`).

Run: `cd pwa && npm run build`
Expected: exit 0 — no PWA file imports the new module yet, but `pwa/tsconfig.json`'s `include` compiles it.

- [ ] **Step 13: Mutation check (spec §18 "one push per tag, across restarts", "`notify` gates the push", "the push lands on settings"; D-3295, D-3296, D-3301, D-3314; the refresh route's call site; the no-push-service arm)**

From `server/`, with everything green. Each mutation replaces exact strings, each of which must match exactly once; the original is restored from a byte copy and compared, never with `git checkout --`:

```bash
cd server
SNAP="$(mktemp -d)"
for f in src/watch.ts src/update/notify.ts src/update/routes.ts ../shared/update-summary.ts; do cp "$f" "$SNAP/$(basename "$f")"; done
T='test/push-copy.test.ts test/update-notify.test.ts test/update-summary.test.ts'
# mut <file> <from> <to> [<from> <to>] — every <from> must match exactly once; then the files in $T, then restore
mut() {
  local f="$1"; shift
  node -e 'const fs=require("fs");const [f,...p]=process.argv.slice(1);let s=fs.readFileSync(f,"utf8");
    for(let i=0;i<p.length;i+=2){const n=s.split(p[i]).length-1;if(n!==1){console.error("pair "+(i/2+1)+" matched "+n+" times");process.exit(9)}s=s.replace(p[i],()=>p[i+1])}
    fs.writeFileSync(f,s);' "$f" "$@" || return
  ./node_modules/.bin/vitest run $T 2>&1 | grep -E '^ +×|Tests '
  cp "$SNAP/$(basename "$f")" "$f" && cmp "$f" "$SNAP/$(basename "$f")" && echo restored
}
# M1 — §18 "one push per tag, across restarts": the mark is skipped
mut src/watch.ts "      marked = coord.markReleaseNotified(n.tag, now);" "      marked = { ok: true, notifiedAt: now };"
# M2 — §18 "notify gates the push": the fleet row's notify mode is ignored
mut src/watch.ts "      const fleetIntent = coord.intentFor(FLEET_SCOPE);" "      const fleetIntent = { ...coord.intentFor(FLEET_SCOPE)!, notify: 'channel' as const };"
# M3 — §18 "the push lands on settings": url dropped from the payload
mut src/watch.ts ", url: copy.url };" " };"
# M4 — dev:sessionless-push: the send routed through pushOne, the session-keyed lane
mut src/watch.ts "    const sending = sender.notify(payload);" "    this.pushOne({ kind: 'coord', sessionId: 'cc-a', project: '', title: payload.title, body: payload.body, tag: payload.tag }, new Set()); const sending: Promise<void> = Promise.resolve();"
# M5 — the server-role gate removed
mut src/watch.ts "    if (role !== 'server' && role !== 'both') return { did: 'skipped', why: 'not-server-role' };" ""
# M6 — dev:notify-mark-before-send: the mark moved AFTER the send starts
mut src/watch.ts "      marked = coord.markReleaseNotified(n.tag, now);" "      marked = { ok: true, notifiedAt: now };" \
  "    void sending.catch(" "    coord.markReleaseNotified(n.tag, now); void sending.catch("
# M7 — a lost mark still sends
mut src/watch.ts "    if (!marked.ok) return { did: 'refused', tag: n.tag, why: marked.why };" ""
# M8 — a failing store warns on every call
mut src/watch.ts "if (detail !== this.lastReleasePushFailure) " ""
# M9 — the inventory lane's call site removed
mut src/watch.ts "    this.pushRelease(now);" ""
# M10 — the catalogue lane's continuation removed
mut src/watch.ts ".then(() => { this.pushReleaseAfterPoll(Date.now()); })" ""
# M11 — §18 "the push lands on settings", the copy's half
mut src/update/notify.ts "    url: RELEASE_PUSH_URL," "    url: '/',"
# M12 — local mode's both row is no longer the fleet side
mut ../shared/update-summary.ts " ?? (server !== null && server.role === 'both' ? server : null)" " ?? null"
# M13 — two unversioned sides "agree"
mut ../shared/update-summary.ts "typeof fleet.version === 'string' && " ""
# M15 — the refresh route's call site removed (bash scopes a prefix assignment to the function call, so T is
#       the routes suite for this one line only)
T='test/update-routes.test.ts' mut src/update/routes.ts "    watcher?.pushReleaseAfterPoll(Date.now());" ""
# M16 — the no-push-service arm removed: a box with no sender decides, marks, and throws on the send
mut src/watch.ts "    if (sender === undefined) return { did: 'skipped', why: 'no-push-service' };" ""
# M17 — dev:notify-waits-for-this-process-sweep: the catalogue side decides before this process has swept
mut src/watch.ts "    if (!this.inventorySwept) return { did: 'skipped', why: 'not-yet-swept' };" ""
# M18 — the flag is never set: the catalogue side never decides
mut src/watch.ts "    this.inventorySwept = true;" ""
# M14 — dev:one-summary-sentence: a second holder of the clause (the single-definition scan)
node -e 'const fs=require("fs");const f="src/update/notify.ts";const a="export const RELEASE_PUSH_URL = '"'"'/settings'"'"';";const s=fs.readFileSync(f,"utf8");
  if(s.split(a).length!==2)process.exit(9);fs.writeFileSync(f,s.replace(a,()=>a+" // fleet and server are on "));'
./node_modules/.bin/vitest run test/single-definition.test.ts -t 'release summary clause' 2>&1 | grep -E '^ +×|Tests |deeply equal'
cp "$SNAP/notify.ts" src/update/notify.ts && cmp src/update/notify.ts "$SNAP/notify.ts" && echo restored
```

Expected red sets. M12 and M13 were MEASURED on this task's `update-summary.test.ts` against this task's `shared/update-summary.ts` (vitest 4.1.10); M11's `update-notify.test.ts` half was measured the same way on the three copy cases. The rest are PREDICTED from the cases above, because W2 and Tasks 1–2 were not on the tree this plan was written against — the worker measures each and records the real set in the wave report, and a mutation that reds FEWER cases than listed is a finding, not a pass:

| Mutation | Red cases (push-copy unless marked) | Count |
|---|---|---|
| M1 | the pinned copy (`notifiedAt` null); sends once per tag; across a restart; a fleet already on the newest tag; commits the mark before notify; a send that rejects is not retried (`calls` 2); a mark that loses sends nothing (the spy is never reached); the catalogue lane waits for this process's first inventory run (`notifiedAt` null after the run) | 8 |
| M2 | `notify: 'stable'` skips a newer dev tag; `notify: 'off'` sends nothing and marks nothing | 2 |
| M3 | the pinned copy; the inventory lane | 2 |
| M4 | the pinned copy (keys carry `sessionId`, no `url`); a visible session does not suppress it; no feed row (`log.seq` 1); the inventory lane; a send that rejects is not retried (no warning — and vitest also reports the rejecting double's promise as an unhandled rejection, which `pushOne` never catches) | 5 |
| M5 | a fleet-role process neither sends nor marks | 1 |
| M6 | commits the mark before notify (`seen` is `[null]`); a mark that loses sends nothing (the mark now runs after the send); a fleet already on the newest tag and the catalogue lane waits for this process's first inventory run (a mark-only decision returns before the moved mark, so `notifiedAt` stays null) | 4 |
| M7 | a mark that loses sends nothing | 1 |
| M8 | a store that throws is a failed decision (two warnings) | 1 |
| M9 | the inventory lane; the catalogue lane waits for this process's first inventory run (the run decides nothing, so `notifiedAt` stays null) | 2 |
| M10 | the catalogue lane (`vi.waitFor` times out: `expected [] to deeply equal [ 'release-v0.0.9' ]`); the catalogue lane waits for this process's first inventory run (`pushReleaseAfterPoll` is never called, so its `vi.waitFor` times out) | 2 |
| M11 | the pinned copy; the inventory lane; `update-notify.test.ts` "spells the title, body, collapse tag and url once" (measured: `1 failed \| 2 passed` in that file's three cases) | 3 |
| M12 | `update-summary.test.ts` "local mode's one `both` row is both sides" and "server = the first server-or-both row; fleet = …" (measured: `2 failed \| 7 passed`); push-copy's inventory lane and catalogue lane — each reads a lone `both` row, whose summary becomes `fleet — · server v0.0.7` | 4 |
| M13 | `update-summary.test.ts` "an unversioned side is named, and two unversioned sides never "agree"" (measured: `1 failed \| 8 passed`) | 1 |
| M15 | `update-routes.test.ts` "a refresh whose poll lists a newer tag sends ONE release push, from the request itself" (`expected [] to deeply equal [ [ 'ccrc v0.0.10 is out', … ] ]`) | 1 |
| M16 | no push service decides and marks nothing (`pushRelease` throws `TypeError` reading `notify` of undefined) | 1 |
| M17 | the catalogue lane waits for this process's first inventory run (the poll's decision is `pushed` on the stale v0.0.7 row, not `not-yet-swept`) | 1 |
| M18 | the catalogue lane (`vi.waitFor` times out — every catalogue-side decision is `not-yet-swept`) | 1 |
| M14 | `single-definition.test.ts` "'fleet and server are on ' is spelled in shared/update-summary.ts and nowhere else" (`expected [ 'shared/update-summary.ts', 'server/src/update/notify.ts' ] to deeply equal [ 'shared/update-summary.ts' ]`, in the walk's root order) | 1 |

Every line ends `restored`. Then run Step 12's first command once more — green — and `git diff --stat` names only this task's ten files.

- [ ] **Step 14: Commit**

```bash
git add shared/update-summary.ts server/src/update/notify.ts server/src/push.ts server/src/watch.ts \
  server/src/update/routes.ts server/test/push-copy.test.ts server/test/single-definition.test.ts \
  server/test/update-notify.test.ts server/test/update-summary.test.ts server/test/update-routes.test.ts
git commit -m "feat(update): one Web Push per release tag — marked before it is sent, sessionless, landing on /settings" \
  -m "FleetWatcher.pushRelease decides (releaseToNotify), commits releases.notifiedAt (markReleaseNotified), then starts push.notify unawaited and never retries it; it runs at the end of every inventory run and, once this process has swept, after every catalogue poll (the tick's and POST /api/updates/refresh's), on a server-role process with a push service only, with no session, presence gate or feed record. PushPayload gains an additive url ('/settings'); the 'fleet and server are on …' clause is declared once, in shared/update-summary.ts. Design 2026-09-20 §13, §18 'one push per tag, across restarts', 'notify gates the push', 'the push lands on settings'." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: `push-sw.js` — the tap lands on `url`

**Files:**
- Modify: `pwa/public/push-sw.js` — `PATH_BASE` and a `sameOriginPath(u)` helper above `openApp`'s docstring (`/** Open (or focus) the app at \`url\`. …`, `:63`); the `push` listener's `data:` (`:58`) gains `url: sameOriginPath(data.url)`; `notificationclick`'s target (`:104`, the line after `const sid = …` at `:103`) prefers `sameOriginPath(notification.data && notification.data.url)`; the ask-action branch (`:109-114`), `openApp` (`:64-78`) and `replace()` (`:82-86`) are unchanged. The file is cited by no line anchor in the session-hook audit's corpus (README `:1342` names it, with no line), so the inserts need not be line-neutral.
- Test: `pwa/test/push-sw.test.ts` — a new `describe('push-sw: a payload url (design 2026-09-20 §13)')` appended after the last describe (`describe('push-sw: the plain tap is unchanged')`, `:233-266`, the file's last line); the harness (`:11-90`) and all 17 existing cases unchanged and green.

**Interfaces:**
- Consumes: the payload's `url?: string` (Task 3's `PushPayload`, `url: RELEASE_PUSH_URL` = `'/settings'`); the harness `load()`, `click(self, action, data, extra)`, `push(self, payload)` and the module-level `opened`, `posted`, `shown` (`push-sw.test.ts:11-90`).
- Produces (in `push-sw.js`, plain JS, not exported — the file is `importScripts`'d, `vite.config.ts:64-66`):

```js
/** The base sameOriginPath resolves against; only its (special) scheme matters, and `.invalid`
 *  (RFC 2606) can never be the app's own origin. */
const PATH_BASE = 'https://sw.invalid';
/** A path this origin serves, or null: a string that starts with '/' AND that the WHATWG URL
 *  parser keeps on PATH_BASE's origin — answered AS WRITTEN, never normalised. Anything else —
 *  absolute, cross-origin, protocol-relative, backslash- or tab-escaped, not a string, empty — is
 *  null, and the tap falls back to /s/<sid> or '/'. */
function sameOriginPath(u) { /* … */ }
// push listener:     data: { sessionId: data.sessionId || null, url: sameOriginPath(data.url), actions },
// notificationclick: const url = sameOriginPath(notification.data && notification.data.url)
//                      ?? (sid ? `/s/${encodeURIComponent(sid)}` : '/');
```

- **Corrected against the skeleton:** the skeleton's rule was a PREFIX check ("starts with ONE '/' that is not '//' or '/\'"). Measured with node's WHATWG `URL` (the parser both a service worker and jsdom use): the parser strips ASCII tab/LF/CR anywhere in the input, so `'/\t/evil.example'` resolves to host `evil.example` while its second character is a tab — the prefix check admits it. The parser therefore decides. And the helper answers the input string, not `new URL(…).pathname`: `'/.//evil.example'` resolves same-origin with pathname `'//evil.example'`, which handed on to `navigate()`/`openWindow()` would be protocol-relative. Both are pinned below.
- New cases (10): a push carrying `url: '/settings'` stashes `data` `{ sessionId: null, url: '/settings', actions: [] }`; a push with no `url` stashes `url: null`; eight hostile values (`'https://evil.example/x'`, `'//evil.example/x'`, `'/\\evil.example'`, `'/\t/evil.example'`, `'javascript:alert(1)'`, `'settings'`, `''`, `42`) each stash `null`; a plain tap with `data.url: '/settings'` opens `['/settings']` and posts nothing; the round trip (the `data` the push listener stashed, tapped) opens `['/settings']`; a `url` beside a `sessionId`, with no action and with a non-ask action, opens the `url`; an absent or `null` `url` opens today's `'/'` / `'/s/cc-a'`; each hostile value, tapped with and without a session, opens `'/'` / `'/s/cc-a'`; `'/.//evil.example'` is stashed and opened as written; an `ask:k:0` action with a session and a `url` still POSTs the answer and opens nothing.
- Spec §18 row pinned: "the push lands on settings" (mutation column: "`url` is dropped from the payload" — the SW half: drop `url` from the `push` listener's `data` → the stash and round-trip cases red; drop the preference → the tap cases red). Plus the Review Focus item 5 hazard (a push `url` that is not ours): the filter's four mutations below.

- [ ] **Step 1: Write the failing tests**

Append to `pwa/test/push-sw.test.ts`, after the closing `});` of `describe('push-sw: the plain tap is unchanged')` (the file's last line, `:266`):

```ts

// Design 2026-09-20 §13: a release push carries no session, so its tap has
// nowhere to deep-link; the payload's `url` ('/settings') is the target instead.
// The url is a SAME-USER-WRITABLE string once it is in a payload, and a tap
// that navigated wherever it pointed would make every push an open redirect —
// so only a path this origin serves is honoured, decided by the URL parser
// itself (a hand-rolled prefix check misses the tab the parser strips), and
// anything else falls back to exactly the target the tap had before.
describe('push-sw: a payload url (design 2026-09-20 §13)', () => {
  const HOSTILE: unknown[] = [
    'https://evil.example/x',  // absolute, another origin
    '//evil.example/x',        // protocol-relative
    '/\\evil.example',         // the parser reads a backslash as a slash: '//evil.example'
    '/\t/evil.example',        // the parser strips the tab: '//evil.example' again
    'javascript:alert(1)',     // not a path at all
    'settings',                // relative to the worker's own path, not a root path
    '',
    42,
  ];

  it('stashes the url into the notification data, beside the session', async () => {
    const self = load();
    await push(self, { title: 'ccrc v0.0.9 is out', body: 'b', tag: 'release-v0.0.9', url: '/settings' });
    expect(shown[0]!.opts.data).toEqual({ sessionId: null, url: '/settings', actions: [] });
  });

  it('stashes null when the payload carries no url — an older server, a session push', async () => {
    const self = load();
    await push(self, { title: '✓ Finished', body: 'back to idle', sessionId: 'cc-a' });
    expect(shown[0]!.opts.data).toEqual({ sessionId: 'cc-a', url: null, actions: [] });
  });

  it('stashes null for a url that is not a path this origin serves', async () => {
    for (const url of HOSTILE) {
      shown = [];
      const self = load();
      await push(self, { title: 't', body: 'b', url });
      expect((shown[0]!.opts.data as { url: unknown }).url, `stashed ${JSON.stringify(url)}`).toBeNull();
    }
  });

  it('a plain tap opens the url and posts nothing', async () => {
    const self = load();
    await click(self, '', { sessionId: null, url: '/settings', actions: [] });
    expect(opened).toEqual(['/settings']);
    expect(posted).toEqual([]);
  });

  it('the push it showed is the tap that lands on /settings — the round trip', async () => {
    const self = load();
    await push(self, { title: 'ccrc v0.0.9 is out', body: 'b', tag: 'release-v0.0.9', url: '/settings' });
    await click(self, '', shown[0]!.opts.data);
    expect(opened).toEqual(['/settings']);
  });

  it('a url wins over the session deep-link when no answer was tapped', async () => {
    const self = load();
    await click(self, '', { sessionId: 'cc-a', url: '/settings' });
    expect(opened).toEqual(['/settings']);
    opened = [];
    await click(self, 'something-else', { sessionId: 'cc-a', url: '/settings' });
    expect(opened).toEqual(['/settings']);
    expect(posted).toEqual([]);
  });

  it('an absent or null url keeps today\'s targets — /s/<sid>, else /', async () => {
    const self = load();
    await click(self, '', {});
    await click(self, '', { url: null });
    await click(self, '', { sessionId: 'cc-a', url: null });
    await click(self, '', { sessionId: 'cc-a' });
    expect(opened).toEqual(['/', '/', '/s/cc-a', '/s/cc-a']);
  });

  it('a url that is not a path this origin serves is ignored — the tap falls back', async () => {
    for (const url of HOSTILE) {
      opened = [];
      const self = load();
      await click(self, '', { url });
      await click(self, '', { sessionId: 'cc-a', url });
      expect(opened, `tapped ${JSON.stringify(url)}`).toEqual(['/', '/s/cc-a']);
    }
  });

  it('keeps the path as written — never normalised into a protocol-relative one', async () => {
    // '/.//evil.example' resolves, against any origin, to a same-origin page whose
    // PATHNAME is '//evil.example'. Handing that normalised pathname to
    // navigate()/openWindow() would make it protocol-relative — another host.
    const self = load();
    await push(self, { title: 't', body: 'b', url: '/.//evil.example' });
    expect((shown[0]!.opts.data as { url: unknown }).url).toBe('/.//evil.example');
    await click(self, '', { url: '/.//evil.example' });
    expect(opened).toEqual(['/.//evil.example']);
  });

  it('never diverts an answer: an ask action with a session still POSTs it', async () => {
    const self = load();
    await click(self, 'ask:k:0', { sessionId: 'cc-a', url: '/settings' },
      { actions: [{ action: 'ask:k:0', title: 'Red' }] });
    expect(posted).toEqual([{ url: '/api/sessions/cc-a/ask', body: { askKey: 'k', optionIndexes: [0] } }]);
    expect(opened).toEqual([]);
    expect(shown.at(-1)!.title).toBe('Answered');
  });
});
```

- [ ] **Step 2: Run the file to verify it fails**

Run: `cd pwa && ./node_modules/.bin/vitest run test/push-sw.test.ts` (foreground; `npm ci` first if `pwa/node_modules` is absent)
Expected: FAIL — `Tests  7 failed | 20 passed (27)`. The seven: "stashes the url into the notification data, beside the session" (`expected { sessionId: null, actions: [] } to deeply equal { sessionId: null, …(2) }`), "stashes null when the payload carries no url …", "stashes null for a url that is not a path this origin serves" (`stashed "https://evil.example/x": expected undefined to be null`), "a plain tap opens the url and posts nothing" (`expected [ '/' ] to deeply equal [ '/settings' ]`), "the push it showed is the tap that lands on /settings — the round trip", "a url wins over the session deep-link when no answer was tapped" (`expected [ '/s/cc-a' ] …`), "keeps the path as written …". The three new cases green BEFORE the edit — "an absent or null url keeps today's targets", "a url that is not a path this origin serves is ignored — the tap falls back", "never diverts an answer" — are pins of behaviour the edit must NOT change; Step 5 shows each binds (M2/M3/M4/M6/M7).

- [ ] **Step 3: Implement in `pwa/public/push-sw.js`**

(a) The `push` listener's `showNotification` options — replace the `data:` line (`:58`), keeping the three comment lines above it:

```js
      data: { sessionId: data.sessionId || null, url: sameOriginPath(data.url), actions },
```

(b) Insert directly ABOVE `/** Open (or focus) the app at \`url\`. The original tap behaviour, unchanged. */` (`:63`), with one blank line after:

```js
/** The base `sameOriginPath` resolves against. Only its SCHEME matters: https
 *  is a special scheme exactly as the app's own origin is (http on a dev box is
 *  special too), so a string resolves against it the way navigate() and
 *  openWindow() will resolve it against ours. `.invalid` is reserved (RFC 2606),
 *  so no origin the app is served from can ever equal it. */
const PATH_BASE = 'https://sw.invalid';

/** A path this origin serves, or null: a string that starts with '/' and that the
 *  URL parser itself keeps on the base's origin. The parser decides, not a prefix
 *  check, because the parser strips tabs and newlines and reads '\\' as '/', so
 *  '/\t/evil.example' and '/\\evil.example' are both '//evil.example' — another
 *  host — while their second character is neither '/' nor '\\'. Anything else
 *  (absolute, cross-origin, protocol-relative, not a string, empty) is null and
 *  the tap falls back to /s/<sid> or '/'.
 *
 *  It answers the string AS WRITTEN, never the parser's normalised pathname:
 *  '/.//evil.example' is a same-origin page whose pathname is '//evil.example',
 *  and that pathname handed back to navigate() would be protocol-relative. */
function sameOriginPath(u) {
  if (typeof u !== 'string' || !u.startsWith('/')) return null;
  try {
    return new URL(u, PATH_BASE).origin === PATH_BASE ? u : null;
  } catch {
    return null;
  }
}
```

`PATH_BASE` is a `const` declared below the `push` listener; that is safe because the listener only READS it when a push event fires, long after the script has finished evaluating, and `sameOriginPath` is a hoisted function declaration.

(c) In the `notificationclick` listener, replace `  const url = sid ? \`/s/${encodeURIComponent(sid)}\` : '/';` (`:104`) with:

```js
  // A payload url (a release push's '/settings', design 2026-09-20 §13) wins
  // over the session deep-link. The push listener filtered it already; it is
  // filtered again here because the data is whatever this notification carries —
  // one shown by an older copy of this worker, or by replace(), has no url, and
  // nothing but this line decides where a tap goes.
  const url = sameOriginPath(notification.data && notification.data.url)
    ?? (sid ? `/s/${encodeURIComponent(sid)}` : '/');
```

The ask branch below it is untouched: it reads `url` only inside `if (m === null || sid === null)`, so a tapped answer with a session still POSTs and never navigates.

- [ ] **Step 4: Run the file to verify it passes, then the type gate**

Run: `cd pwa && ./node_modules/.bin/vitest run test/push-sw.test.ts`
Expected: PASS — `Tests  27 passed (27)` (17 existing + 10 new).

Run: `cd pwa && npm run build`
Expected: exit 0 — `tsc --noEmit` type-checks the new test cases (`pwa/tsconfig.json` includes `test`; `push-sw.js` itself is copied from `public/` verbatim by `vite build` and is not type-checked).

- [ ] **Step 5: Mutation check (spec §18 "the push lands on settings"; Review Focus 5)**

From `pwa/`, with the file green. Each mutation is ONE exact-string replacement that must match exactly once; the original is restored from a byte copy and compared, never with `git checkout --`:

```bash
cd pwa
ORIG="$(mktemp -d)/push-sw.js.orig"; cp public/push-sw.js "$ORIG"
mut() {
  node -e 'const fs=require("fs");const [f,a,b]=process.argv.slice(1);const s=fs.readFileSync(f,"utf8");
    const n=s.split(a).length-1;if(n!==1){console.error("mutation matched "+n+" times");process.exit(9)}
    fs.writeFileSync(f,s.replace(a,()=>b));' public/push-sw.js "$1" "$2" || return
  ./node_modules/.bin/vitest run test/push-sw.test.ts 2>&1 | grep -E '^ +×|Tests'
  cp "$ORIG" public/push-sw.js && cmp public/push-sw.js "$ORIG" && echo restored
}
# M1 — the §18 row: url dropped from the stashed data
mut 'url: sameOriginPath(data.url), ' ''
# M2 — the preference dropped: the tap reads the session alone again
mut '  const url = sameOriginPath(notification.data && notification.data.url)
    ?? (sid' '  const url = (sid'
# M3 — the parser replaced by the skeleton's prefix check
mut '    return new URL(u, PATH_BASE).origin === PATH_BASE ? u : null;' "    return u[1] !== '/' && u[1] !== '\\\\' ? u : null;"
# M4 — no filter: any string honoured
mut "  if (typeof u !== 'string' || !u.startsWith('/')) return null;" "  if (typeof u === 'string') return u;"
# M5 — the parser's normalised pathname answered instead of the input
mut 'origin === PATH_BASE ? u : null;' 'origin === PATH_BASE ? new URL(u, PATH_BASE).pathname : null;'
# M6 — a url diverts an answer
mut 'if (m === null || sid === null) {' 'if (m === null || sid === null || url !== `/s/${encodeURIComponent(sid)}`) {'
# M7 — the fallback loses the session deep-link
mut "    ?? (sid ? \`/s/\${encodeURIComponent(sid)}\` : '/');" "    ?? '/';"
```

Expected (measured on a copy of the file at `d759c914` with this task's edit applied, vitest 4.1.10 under jsdom; each line ends `restored`):

| Mutation | Red cases | Count |
|---|---|---|
| M1 | stashes the url …; stashes null when … no url; stashes null for a url that is not …; the round trip; keeps the path as written | `5 failed \| 22 passed` |
| M2 | a plain tap opens the url …; the round trip; a url wins over the session deep-link …; keeps the path as written | `4 failed \| 23 passed` |
| M3 | stashes null for a url that is not … (`stashed "/\t/evil.example": expected '/\t/evil.example' to be null`); a url that is not … is ignored (`tapped "/\t/evil.example"`) | `2 failed \| 25 passed` |
| M4 | stashes null when … no url; stashes null for a url that is not …; a url that is not … is ignored | `3 failed \| 24 passed` |
| M5 | keeps the path as written — never normalised into a protocol-relative one | `1 failed \| 26 passed` |
| M6 | never diverts an answer: an ask action with a session still POSTs it | `1 failed \| 26 passed` |
| M7 | three existing plain-tap cases (deep-links …; deep-links for an action id …; encodes a session id …); an absent or null url keeps today's targets; a url that is not … is ignored | `5 failed \| 22 passed` |

Then run the file green once more: `./node_modules/.bin/vitest run test/push-sw.test.ts` → `27 passed (27)`, and `git diff --stat` names only the two files of this task.

- [ ] **Step 6: Commit**

```bash
git add pwa/public/push-sw.js pwa/test/push-sw.test.ts
git commit -m "feat(update): a push tap opens the payload's same-origin url — the release push lands on /settings" \
  -m "push-sw.js stashes url into the notification's data and notificationclick prefers it over /s/<sid>. The URL parser decides same-origin (a prefix check admits '/<tab>/host'); the path is kept as written, never normalised to '//host'. Design 2026-09-20 §13, §18 'the push lands on settings'." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: The PWA client + poll hook

**Files:**
- Modify: `pwa/src/lib/api.ts` — the import line (`:5`) gains `AckAnswer, AutoMode, CatalogueState, IntentWriteAnswer, NotifyMode, UpdateChannel, UpdateRouteError, UpdatesView` (type-only, in place — one line, the names in the line's alphabetical order); `MOVE_DISABLED_TEXT`, `UpdateIntentRequest` and `UPDATE_ERROR_TEXT`/`updateErrorText` after `kickoffErrorText` (`:294`), before `createApi` (`:296`); four methods in the returned object directly after `rebootFleet` (`:478`)
- Create: `pwa/src/fleet/useUpdatesView.ts`
- Test: `pwa/test/api.test.ts` — the value import (`:4`) gains `MOVE_DISABLED_TEXT, submitErrorText, updateErrorText` IN PLACE, one type import line is added directly under it (CORRECTED: the skeleton said "one describe appended" alone, but the new cases need `FLEET_SCOPE` and four W2 wire types for typed fixtures, and `submitErrorText`, the fifth existing translator); two describes appended after the last line (`:1042`), in the `jsonResponse`/`asError`/`createApi(fetchImpl)` idiom (`:1-15`). No audited corpus cites `pwa/test/api.test.ts` or `pwa/src/lib/api.ts` by line (measured at `d759c914`: `git grep -n 'lib/api.ts:[0-9]\|api.test.ts:[0-9]' -- README.md CLAUDE.md server/test pwa/test pwa/src shared` answers only two unaudited comments, `CoordBanner.tsx:47` and `coord-banner.test.tsx:177`, both citing `lib/api.ts:153-164` — above every line this task inserts, and the `:5` import is replaced in place, so neither moves), so neither edit is line-constrained.
- Test: `pwa/test/use-updates-view.test.tsx` (create — `renderHook`, the `useProjectedHome.test.ts:6-14` idiom, and the `fleet-host-banner.test.tsx:29-46` newest-issued idiom with `Promise.withResolvers`)
- NOT edited here: `pwa/src/screens/FleetScreen.tsx` and its tick census (`fleet-screen.test.tsx`'s `ticksOf` docstring, `:2369-2386`) — the hook's first FleetScreen mount is Task 11's, so the census names `useUpdatesView` (60_000) there, where the interval first exists. No file `session-hook.test.ts`'s citation audit cites is touched (`shared/api.ts`, `single-definition.test.ts`, README), so R13 governs nothing here; `single-definition.test.ts` is RUN in Step 6 because it walks `pwa/src` from the filesystem; `topology-clean.test.ts` is RUN in Step 8, AFTER `git add` and before the commit, because its corpus is `git ls-files` (the index, `topology-clean.test.ts:76`, `trackedPaths`) — at Step 6 the two new files are untracked (`??`) and invisible to it, so a green run there would measure nothing about them. *(CORRECTED: this task said both ran in Step 6.)*

**Interfaces:**
- Consumes: `getJson`, `postJson`, `postJsonOr`, `ApiError`, `apiErrorText` (`api.ts:8-23`, `:235-261`, `:325-383` — `getJson` `:325`, `jsonInit` `:347`, `postJson` `:359`, `postJsonOr` `:382`); the five existing translators this table must stay disjoint from — `sendErrorText` (`:69`), `submitErrorText` (`:94`), `uploadErrorText` (`:108`), `apiErrorText` (`:235`), `kickoffErrorText` (`:294`) (CORRECTED: the skeleton said "the existing four"; there are five exported, and `submitErrorText` is the one the mutual-exclusion suite at `api.test.ts:704-778` does not name); W2's `UpdatesView`, `NodeWire`, `CatalogueState`, `IntentWriteAnswer`, `AckAnswer`, `UpdateIntentWire`, `UpdateRouteError`, `UpdateChannel`, `AutoMode`, `NotifyMode`, `FLEET_SCOPE`, `isReleaseTag`, `isUpdateChannel` (`shared/api.ts`, W2 Task 1's end-of-file block) — `isUpdateChannel` ADDED to the list (see `pendingTag`); `isNewerTag` (`shared/semver.ts`, W2 Task 2 — throws `RangeError` on a non-tag, so both arguments pass `isReleaseTag` first); the routes' answers (W2 Task 13's route table): `GET /api/updates` → `200 UpdatesView` | `501 {ok:false, error:'not-configured'}`; `POST /api/updates/intent` `{scope, channel?, pinnedTag?, auto?, notify?}` (W2's `INTENT_BODY_KEYS`) → `200 IntentWriteAnswer` | `400`/`404`/`409`/`503`/`501`; `POST /api/updates/refresh` → `200 CatalogueState` | `429 rate-limited {retryAfterS}` | `501`; `POST /api/updates/ack` `{nodeId}` → `200 AckAnswer` | `400`/`404`/`409`/`501`.
- Produces (in `pwa/src/lib/api.ts`):

```ts
/** The one sentence every disabled move control carries in W3 (spec §13). */
export const MOVE_DISABLED_TEXT = 'lands with the next release (W4)';

export interface UpdateIntentRequest {
  scope: string; channel?: UpdateChannel; pinnedTag?: string | null; auto?: AutoMode; notify?: NotifyMode;
}

/** The update routes' refusals (D-3302): keyed by W2's union, so a word W2
 *  adds is a compile error; 'unauthenticated' is absent (a 401 raises the login screen through request()). */
const UPDATE_ERROR_TEXT: Record<Exclude<UpdateRouteError, 'unauthenticated'>, string>;
/** err.body.error looked up in UPDATE_ERROR_TEXT FIRST (own keys only, Object.hasOwn); any other error →
 *  apiErrorText(err). */
export function updateErrorText(err: unknown): string;

// createApi()'s returned object, after rebootFleet:
updates: () => getJson<UpdatesView>('/api/updates'),
setUpdateIntent: (body: UpdateIntentRequest) =>
  postJsonOr<IntentWriteAnswer | 'unreadable'>('/api/updates/intent', 'unreadable', body),
refreshUpdates: () => postJson<CatalogueState>('/api/updates/refresh'),
ackUpdateNode: (nodeId: string) =>
  postJsonOr<AckAnswer | 'unreadable'>('/api/updates/ack', 'unreadable', { nodeId }),
```

- `UPDATE_ERROR_TEXT`'s sentences (pinned by `api.test.ts`): `not-configured` → `This box has no update control plane — it runs without a coordination database.`; `bad-tag` → `That is not a release tag — tags look like v0.0.9.`; `bad-request` → `The server refused the shape of that request — reload the screen and try again.`; `unknown-scope` → `That node has no identity yet — it follows the fleet setting until an install gives it one.`; `unknown-node` → `That node is no longer in the inventory.`; `superseded` → `That node was reinstalled under a new identity — reload to see it.`; `busy` → `That node is mid-update — wait for it to settle, then acknowledge.`; `auto-needs-rollback-gate` → `Auto-install needs the rollback gate on every node, and at least one does not carry it yet.`; `rate-limited` → `GitHub was asked less than a minute ago — try again in a minute.` (a request went out, not that it landed: W2's refresh route 429s inside a minute of `lastRequestAt()`, which a FAILED request and the scheduled poll both set, D-3203 — so the sentence must not say "checked" over a `lastOkAt` that may be null; Task 7 pins it over an unreached catalogue); `no-channel` → `A stored channel is one this build cannot read — choose the channel again.`; `journal-unreadable` → `The server cannot read its intent journal — nothing was changed.`; `journal-unwritable` → `The server cannot write its intent journal — nothing was changed.`
- Produces (in `pwa/src/fleet/useUpdatesView.ts`):

```ts
export const UPDATES_POLL_MS = 60_000;
export type UpdatesFailure = 'not-configured' | 'failed';
export interface UpdatesPoll {
  view: UpdatesView | null;          // the LAST GOOD answer — a later failure never clears it
  failure: UpdatesFailure | null;    // the latest poll's failure; null after a good answer
  reload: () => void;                // one poll now (after a write), same newest-issued guard; a no-op in the injected mode
}
/** null unless catalogue is an object whose lastOkAt is null or a finite number and whose lastError is null or
 *  {at: number, reason: string}, and releases, nodes and intent are arrays — a malformed answer is a failure,
 *  never an empty fleet. Elements are passed through as the wire types (the server is the one writer). */
export function asUpdatesView(raw: unknown): UpdatesView | null;
/** current.version when it passes isReleaseTag, else null (unversioned, unreadable, or no stamp). */
export function nodeVersion(n: NodeWire): string | null;
/** THE ONE ARROW PREDICATE: n.desiredTag iff typeof measuredAt === 'number' AND isUpdateChannel(channel)
 *  AND isReleaseTag(desiredTag) AND (nodeVersion(n) === null OR isNewerTag(desiredTag, nodeVersion(n))); else null. */
export function pendingTag(n: NodeWire): string | null;
/** GET /api/updates every pollMs and on visibilitychange → 'visible'; newest issued request wins (the
 *  useFleetHealth issued/mine guard); functional setState; an ApiError 501 whose body.error is 'not-configured'
 *  → failure 'not-configured', any other rejection or asUpdatesView null → 'failed'. pollMs <= 0 = the injected
 *  mode: no request, no interval, no listener. */
export function useUpdatesView(pollMs?: number): UpdatesPoll;
```

- **Corrections to the skeleton's interface — 1-4 are tightenings no later task's reading loosens; 5-6 are notes:**
  1. `asUpdatesView` also checks the catalogue's two FIELDS, not only that it is an object. Tasks 7 and 11 decide "checked" / "a banner" on `catalogue.lastOkAt !== null`; a stub `{catalogue: {}}` would pass an object-only check with `lastOkAt === undefined`, and `undefined !== null` is `true` — the one reading §18's "unreachable is not current" forbids. So `catalogue: {}` (and a string `lastOkAt`, and a `lastError` with no `reason`) is a malformed answer.
  2. `pendingTag` tests `typeof n.measuredAt === 'number'` and `isUpdateChannel(n.channel)` rather than `!== null`: identical on the wire type, and a malformed element (a field ABSENT) reads as "no arrow" instead of as measured — the absence-permits rule. `isUpdateChannel` joins Consumes.
  3. The `not-configured` failure needs BOTH the status and the code (`status === 501 && body.error === 'not-configured'`): a 501 carrying any other word (a proxy's, an older server's `unsupported`) is `'failed'`, so two conditions a caller renders differently ("this box has no control plane" vs "the read failed") never share one value.
  4. `reload` is a no-op in the injected mode (`pollMs <= 0`): a consumer handed a view by its parent re-polls through the parent.
  5. Two anchor corrections to the skeleton's prose, no interface change: `API_ERROR_TEXT['not-configured']` (the kickoff sentence D-3302 quotes) is `api.ts:212`, not `:215`; and this is the SIXTH code table in `lib/api.ts` (SEND, SUBMIT, UPLOAD, API, KICKOFF precede it), not the fifth.
  6. `updateErrorText`'s `Object.hasOwn` membership test is carried but NOT pinned, and says so: a prototype name (`toString`) falls through to `apiErrorText`, whose own `API_ERROR_TEXT[code]` lookup (`api.ts:255-257`, no own-key check) answers the inherited function for the same name, so the two arms cannot be told apart by any assertion on the result. That is a latent defect of `apiErrorText` (it can return a non-string for a body naming a prototype member), out of this wave's scope and left untouched.
- Cases: each client method's URL, method, body and `accept`/`content-type` headers (`fetchImpl.mock.calls[0]`); `setUpdateIntent`/`ackUpdateNode` resolve `'unreadable'` on a 200 with a truncated body while `refreshUpdates` rejects; a request that never completed still rejects `setUpdateIntent`; a 429 rejects with `ApiError` status 429 carrying `retryAfterS`; `updateErrorText` on a 501 `not-configured` is the update sentence (not the kickoff one), `bad-request` is the update sentence (not the upload or kickoff one), and a code it does not own falls to `apiErrorText`; the five existing translators return every update-only code unchanged; `lib/api.ts`'s source spells exactly the four W2 route literals and neither `/api/updates/apply` nor `/api/updates/rollback`; `asUpdatesView` on `{}`, `null`, `[]`, `nodes: {}`, `releases` absent, `catalogue: null`, `catalogue: {}`, a string `lastOkAt`, a reason-less `lastError` → null; the hook: polls at mount and every 60 s, newest issued wins (both arms), 501 `not-configured` → `not-configured`, a 501 with another code → `failed`, a failed/malformed/501 poll after a good one keeps `view`, a good one after clears `failure`, `pollMs = 0` and `-1` issue nothing, `visibilitychange` → visible polls once and → hidden does not, `reload` polls once and is stable across renders, unmount stops both the interval and the listener; `pendingTag` null on `measuredAt: null`, on an absent `measuredAt`, on `channel: null`, on a null or non-tag `desiredTag`, on `desiredTag` equal to current, on an older `desiredTag`, and `'v0.0.10'` over current `'v0.0.9'`; the desired tag over an unversioned, stamp-less or non-tag current.
- Spec §18 rows pinned: "unreachable is not current" (the predicate's half — mutation: drop the `measuredAt` clause → red; and the catalogue half of the guard — mutation: drop the `lastOkAt` check → red), "the move controls are disabled in W3" (the client half: no apply/rollback route literal exists — mutation: add one → red).

- [ ] **Step 1: Write the failing client tests**

In `pwa/test/api.test.ts`, replace line 4 IN PLACE:

```ts
import { ApiError, apiErrorText, clipUrl, createApi, kickoffErrorText, sendErrorText, uploadErrorText, UNSUPPORTED_VERB_TEXT } from '../src/lib/api';
```

with these two lines:

```ts
import { ApiError, apiErrorText, clipUrl, createApi, kickoffErrorText, MOVE_DISABLED_TEXT, sendErrorText, submitErrorText, updateErrorText, uploadErrorText, UNSUPPORTED_VERB_TEXT } from '../src/lib/api';
import { FLEET_SCOPE, type AckAnswer, type CatalogueState, type IntentWriteAnswer, type NodeWire, type UpdateIntentWire, type UpdateRouteError } from '../../shared/api';
```

Then append after the file's last line (`:1042`, the closing `});` of the pool-sentences describe):

```ts

// ── Centralised update management W3, Task 5: the update plane's client ─────
// Design 2026-09-20 §12/§13. Four methods over W2's four session-only routes,
// and each one's helper is a DECISION (lib/api.ts says why at each call): the
// two WRITES degrade an unparseable 2xx to `unreadable`, because the write may
// have landed (D-1150); the refresh does not, because it writes nothing the
// operator could be unconfirmed about. No method exists for the two move routes
// W3 leaves disabled — pinned below by the route literals the file spells.
describe('the update plane client (W3 Task 5)', () => {
  const INTENT: UpdateIntentWire = {
    scope: FLEET_SCOPE, channel: 'dev', pinnedTag: null, auto: 'off', notify: 'channel', setAt: 5_000, setBy: 'operator',
  };
  const CATALOGUE: CatalogueState = { lastOkAt: 4_000, lastError: null };
  const NODE: NodeWire = {
    nodeId: '0f0e0d0c-0b0a-4908-8706-050403020100', role: 'fleet', label: 'fleet', os: 'linux',
    current: { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-22T00:00:00Z', dirty: false, version: 'v0.0.9' },
    stampRead: 'ok', installState: 'complete', provenance: 'verified',
    caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
    measuredAt: 1_000, reachable: true, unreachableSince: null,
    channel: 'dev', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
    update: { state: 'idle', target: null, startedAt: null, detail: null },
  };
  /** A 2xx whose body stops mid-object — the exchange completed, the answer did not. */
  const truncated = (): Response => new Response('{"ok":true,"inte', {
    status: 200, headers: { 'content-type': 'application/json' },
  });

  it('updates() is a bare GET of /api/updates — no init at all, the fleetHealth shape', async () => {
    const body = { catalogue: CATALOGUE, releases: [], nodes: [NODE], intent: [INTENT] };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await expect(api.updates()).resolves.toEqual(body);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('/api/updates');
    expect(init).toBeUndefined();
  });

  it('setUpdateIntent POSTs the partial as JSON, asks for JSON back, and resolves the answer', async () => {
    const answer: IntentWriteAnswer = { ok: true, intent: INTENT, epoch: 7 };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, answer));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await expect(api.setUpdateIntent({ scope: FLEET_SCOPE, channel: 'dev' })).resolves.toEqual(answer);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/updates/intent');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
    // EXACTLY the two keys given — W2's parseIntentBody refuses an unknown key,
    // and an omitted one keeps its stored value (a partial, not a snapshot).
    expect(JSON.parse(init.body as string)).toEqual({ scope: '*', channel: 'dev' });
    // Session-gated only (W2 Task 13): no box token rides an operator write.
    expect(new Headers(init.headers).get('x-ccrc-mail-token')).toBeNull();
  });

  it('setUpdateIntent resolves `unreadable` on a 2xx it cannot parse — the write may have landed (D-1150)', async () => {
    const api = createApi(async () => truncated());
    await expect(api.setUpdateIntent({ scope: FLEET_SCOPE, notify: 'off' })).resolves.toBe('unreadable');
    const emptied = createApi(async () => new Response('', { status: 200 }));
    await expect(emptied.setUpdateIntent({ scope: FLEET_SCOPE, notify: 'off' })).resolves.toBe('unreadable');
  });

  it('setUpdateIntent still rejects a request that never completed, and a refusal keeps its body', async () => {
    const offline = createApi(async () => { throw new TypeError('Failed to fetch'); });
    await expect(offline.setUpdateIntent({ scope: FLEET_SCOPE, auto: 'stable' })).rejects.toThrow(/failed to fetch/i);

    const refusal = { ok: false, error: 'auto-needs-rollback-gate', nodes: ['fleet', 'server'] };
    const refused = createApi(vi.fn().mockResolvedValue(jsonResponse(409, refusal)) as unknown as typeof fetch);
    const err = await refused.setUpdateIntent({ scope: FLEET_SCOPE, auto: 'stable' }).then(
      () => { throw new Error('expected setUpdateIntent to reject'); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body).toEqual(refusal);
  });

  it('refreshUpdates POSTs nothing, asks for JSON, and resolves the catalogue line', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, CATALOGUE));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await expect(api.refreshUpdates()).resolves.toEqual(CATALOGUE);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/updates/refresh');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
    expect(new Headers(init.headers).get('content-type')).toBeNull();
    expect(init.body).toBeUndefined();
  });

  it('refreshUpdates REJECTS an unparseable 2xx — it wrote nothing to be unconfirmed about', async () => {
    const api = createApi(async () => truncated());
    const r = await api.refreshUpdates().then(() => 'resolved', (e: unknown) => e);
    expect(r, 'a check whose answer is unreadable is a failed check, not a catalogue line').not.toBe('resolved');
    expect(r).not.toBe('unreadable');
    expect(r).not.toBeInstanceOf(ApiError);
  });

  it('refreshUpdates rejects a 429 with the ApiError the screen reads retryAfterS off', async () => {
    const body = { ok: false, error: 'rate-limited', retryAfterS: 42 };
    const api = createApi(vi.fn().mockResolvedValue(jsonResponse(429, body)) as unknown as typeof fetch);
    const err = await api.refreshUpdates().then(
      () => { throw new Error('expected refreshUpdates to reject'); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).body).toEqual(body);
  });

  it('ackUpdateNode POSTs {nodeId} and resolves `unreadable` on an unparseable 2xx', async () => {
    const answer: AckAnswer = { ok: true, node: NODE };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, answer));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await expect(api.ackUpdateNode(NODE.nodeId)).resolves.toEqual(answer);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/updates/ack');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(new Headers(init.headers).get('accept')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ nodeId: NODE.nodeId });

    const unreadable = createApi(async () => truncated());
    await expect(unreadable.ackUpdateNode(NODE.nodeId)).resolves.toBe('unreadable');
  });

  it('spells exactly the four W2 update routes — no apply, no rollback (spec §18: the move controls are disabled in W3)', () => {
    // The route LITERALS, not a method-name guess: a method named anything at
    // all that reaches either move route has to spell its path, and this is the
    // census of every quoted `/api/updates…` path the client holds.
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'api.ts'), 'utf8');
    const routes = [...new Set(src.match(/'\/api\/updates[^']*'/g) ?? [])].sort();
    expect(routes).toEqual(["'/api/updates'", "'/api/updates/ack'", "'/api/updates/intent'", "'/api/updates/refresh'"]);
    expect(src).not.toContain('/api/updates/apply');
    expect(src).not.toContain('/api/updates/rollback');
  });

  it('MOVE_DISABLED_TEXT is the one literal every disabled move control carries', () => {
    expect(MOVE_DISABLED_TEXT).toBe('lands with the next release (W4)');
  });
});

// D-3302. `updateErrorText` reads `body.error`
// against its OWN table before anything else, because two of its words already
// have owners — `not-configured` is `API_ERROR_TEXT`'s kickoff sentence ("does
// not run coordination … a kickoff"), false on this surface, and `bad-request`
// is the upload and kickoff tables' — and it falls to `apiErrorText` only for a
// code it does not own. It consumes no translator's output and none consumes
// its output, so the composition hazard the describe above guards does not
// arise; what can still go wrong is the other direction, a word of its own
// leaking into another table, and the last case here pins that.
describe('updateErrorText — the update routes\' refusals, read code-first (W3 Task 5)', () => {
  // Typed by W2's union: a word W2 adds, or one this list drops, is a compile
  // error in this file as well as in lib/api.ts — the runtime census and the
  // type census are the same object.
  const SENTENCES: Record<Exclude<UpdateRouteError, 'unauthenticated'>, string> = {
    'not-configured': 'This box has no update control plane — it runs without a coordination database.',
    'bad-tag': 'That is not a release tag — tags look like v0.0.9.',
    'bad-request': 'The server refused the shape of that request — reload the screen and try again.',
    'unknown-scope': 'That node has no identity yet — it follows the fleet setting until an install gives it one.',
    'unknown-node': 'That node is no longer in the inventory.',
    superseded: 'That node was reinstalled under a new identity — reload to see it.',
    busy: 'That node is mid-update — wait for it to settle, then acknowledge.',
    'auto-needs-rollback-gate': 'Auto-install needs the rollback gate on every node, and at least one does not carry it yet.',
    'rate-limited': 'GitHub was asked less than a minute ago — try again in a minute.',
    'no-channel': 'A stored channel is one this build cannot read — choose the channel again.',
    'journal-unreadable': 'The server cannot read its intent journal — nothing was changed.',
    'journal-unwritable': 'The server cannot write its intent journal — nothing was changed.',
  };

  it('has its sentence for every UpdateRouteError but unauthenticated', () => {
    const entries = Object.entries(SENTENCES);
    expect(entries, 'guards the guard — an empty census passes everything').toHaveLength(12);
    for (const [code, sentence] of entries) {
      expect(updateErrorText(asError(409, { ok: false, error: code })), code).toBe(sentence);
    }
  });

  it('not-configured on an update route is the update sentence, not the kickoff one', () => {
    const err = asError(501, { ok: false, error: 'not-configured' });
    expect(updateErrorText(err)).toBe(SENTENCES['not-configured']);
    expect(updateErrorText(err)).not.toBe(apiErrorText(err));
    expect(apiErrorText(err), 'the kickoff sentence is untouched').toMatch(/does not run coordination/i);
  });

  it('bad-request is the update sentence, not the upload or kickoff one', () => {
    const err = asError(400, { ok: false, error: 'bad-request', field: 'channel' });
    expect(updateErrorText(err)).toBe(SENTENCES['bad-request']);
    expect(updateErrorText(err)).not.toBe(uploadErrorText('bad-request'));
    expect(updateErrorText(err)).not.toBe(kickoffErrorText('bad-request'));
  });

  it('falls to apiErrorText for anything it does not own', () => {
    expect(updateErrorText(asError(501, { ok: false, error: 'unsupported' }))).toBe(UNSUPPORTED_VERB_TEXT);
    expect(updateErrorText(asError(401, { ok: false, error: 'unauthenticated' }))).toBe('unauthenticated');
    expect(updateErrorText(asError(500, 'plain text body'))).toBe('request failed (500)');
    expect(updateErrorText(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
  });

  it('the five existing translators pass every update-only code through unchanged', () => {
    // The ten words no other table owns. `not-configured` and `bad-request`
    // are excluded because they HAVE other owners — which is exactly why the
    // update table is read first rather than composed after apiErrorText.
    const updateOnly = Object.keys(SENTENCES).filter((c) => c !== 'not-configured' && c !== 'bad-request');
    expect(updateOnly, 'guards the guard').toHaveLength(10);
    for (const code of updateOnly) {
      expect(apiErrorText(asError(409, { ok: false, error: code })), code).toBe(code);
      expect(sendErrorText(code), code).toBe(code);
      expect(submitErrorText(code), code).toBe(code);
      expect(uploadErrorText(code), code).toBe(code);
      expect(kickoffErrorText(code), code).toBe(code);
    }
  });
});
```

- [ ] **Step 2: Write the failing hook test**

Create `pwa/test/use-updates-view.test.tsx`:

```tsx
// useUpdatesView — the ONE poll of GET /api/updates (design 2026-09-20 §13;
// W3 Task 5) — and the two pure readers every update surface shares:
//
//  • asUpdatesView: a malformed answer is a FAILURE, never an empty fleet. A
//    stub `{}` read as "no nodes, no releases" would render "nothing to update"
//    over a fleet the screen simply failed to read.
//  • pendingTag: THE arrow predicate Tasks 9, 11 and 12 read. No arrow while a
//    node is unmeasured or has no resolved channel (spec §18 "unreachable is
//    not current"), and tags compare as semver — `v0.0.10` is newer than
//    `v0.0.9`, which string order gets backwards.
//
// The hook is `useFleetHealth`'s shape (newest issued request wins, `pollMs <=
// 0` is the injected mode) plus two things that hook does not have: it keeps
// the last GOOD view across a failed poll while reporting the failure beside
// it, and it re-polls when the page becomes visible.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { NodeWire, UpdatesView } from '../../shared/api';
import { ApiError, api } from '../src/lib/api';
import { UPDATES_POLL_MS, asUpdatesView, nodeVersion, pendingTag, useUpdatesView } from '../src/fleet/useUpdatesView';

const setVisibility = (v: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  // The own property `setVisibility` planted shadows jsdom's getter; deleting
  // it restores the prototype's answer for the next file.
  Reflect.deleteProperty(document, 'visibilityState');
});

const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: '0f0e0d0c-0b0a-4908-8706-050403020100', role: 'fleet', label: 'fleet', os: 'linux',
  current: { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-22T00:00:00Z', dirty: false, version: 'v0.0.9' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  measuredAt: 1_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});

const view = (over: Partial<UpdatesView> = {}): UpdatesView => ({
  catalogue: { lastOkAt: 1_000, lastError: null },
  releases: [],
  nodes: [node()],
  intent: [],
  ...over,
});

/** One poll interval, flushed. */
const tick = async (): Promise<void> => {
  await act(async () => { await vi.advanceTimersByTimeAsync(UPDATES_POLL_MS); });
};

describe('asUpdatesView — a malformed answer is a failure, never an empty fleet', () => {
  it('passes a well-formed view through as the same object', () => {
    const v = view();
    expect(asUpdatesView(v)).toBe(v);
    const neverReached = view({ catalogue: { lastOkAt: null, lastError: { at: 5, reason: 'no-egress' } } });
    expect(asUpdatesView(neverReached)).toBe(neverReached);
  });

  it('refuses a non-object and every missing or non-array list', () => {
    for (const raw of [null, undefined, 'x', 7, [], {}]) {
      expect(asUpdatesView(raw), JSON.stringify(raw)).toBeNull();
    }
    const { releases: _r, ...noReleases } = view();
    void _r;
    expect(asUpdatesView(noReleases), 'releases absent').toBeNull();
    expect(asUpdatesView({ ...view(), nodes: {} }), 'nodes: {}').toBeNull();
    expect(asUpdatesView({ ...view(), intent: null }), 'intent: null').toBeNull();
  });

  it('refuses a catalogue that is not the two-field line — `lastOkAt` absent is not "never checked"', () => {
    // The half of "unreachable is not current" this guard owns: the settings
    // line and the banner decide on `lastOkAt !== null`, and `undefined !==
    // null` is true — so an object-only check would let `{}` read as checked.
    expect(asUpdatesView({ ...view(), catalogue: null }), 'catalogue: null').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: [] }), 'catalogue: []').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: {} }), 'catalogue: {}').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: { lastError: null } }), 'lastOkAt absent').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: { lastOkAt: '5', lastError: null } }), 'a string lastOkAt').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: { lastOkAt: Number.NaN, lastError: null } }), 'NaN').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: { lastOkAt: null, lastError: { at: 5 } } }), 'no reason').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: { lastOkAt: null } }), 'lastError absent').toBeNull();
  });
});

describe('nodeVersion and pendingTag — the one arrow predicate', () => {
  it('nodeVersion is the stamp\'s tag, or null when there is none to compare', () => {
    expect(nodeVersion(node())).toBe('v0.0.9');
    expect(nodeVersion(node({ current: null })), 'no stamp').toBeNull();
    const { version: _v, ...untagged } = node().current!;
    void _v;
    expect(nodeVersion(node({ current: untagged })), 'an untagged build').toBeNull();
    expect(nodeVersion(node({ current: { ...untagged, version: 'dev' } })), 'not a tag').toBeNull();
  });

  it('points at a newer desired tag — in semver order, across the v0.0.9 → v0.0.10 boundary', () => {
    expect('v0.0.10' < 'v0.0.9', 'the control: string order gets this pair backwards').toBe(true);
    expect(pendingTag(node({ desiredTag: 'v0.0.10' }))).toBe('v0.0.10');
  });

  it('draws no arrow while the node is unmeasured (spec §18 "unreachable is not current")', () => {
    expect(pendingTag(node({ desiredTag: 'v0.0.10', measuredAt: null }))).toBeNull();
    const absent = { ...node({ desiredTag: 'v0.0.10' }), measuredAt: undefined } as unknown as NodeWire;
    expect(pendingTag(absent), 'measuredAt absent is unmeasured, not measured').toBeNull();
  });

  it('draws no arrow while the node has no resolved channel', () => {
    expect(pendingTag(node({ desiredTag: 'v0.0.10', channel: null }))).toBeNull();
    const absent = { ...node({ desiredTag: 'v0.0.10' }), channel: undefined } as unknown as NodeWire;
    expect(pendingTag(absent), 'channel absent').toBeNull();
  });

  it('draws no arrow for a missing, non-tag, equal or older desired tag', () => {
    expect(pendingTag(node({ desiredTag: null })), 'no desired tag').toBeNull();
    expect(pendingTag(node({ desiredTag: 'latest' })), 'not a tag').toBeNull();
    expect(pendingTag(node({ desiredTag: 'v0.0.9' })), 'equal').toBeNull();
    expect(pendingTag(node({ desiredTag: 'v0.0.8' })), 'older — a rollback is not an update arrow').toBeNull();
  });

  it('points at the desired tag when the node runs nothing it can compare', () => {
    const { version: _v, ...untagged } = node().current!;
    void _v;
    expect(pendingTag(node({ current: untagged })), 'unversioned').toBe('v0.0.9');
    expect(pendingTag(node({ current: null })), 'no stamp').toBe('v0.0.9');
    expect(pendingTag(node({ current: { ...untagged, version: 'dev' } })), 'a non-tag version').toBe('v0.0.9');
  });
});

describe('useUpdatesView — the one poll of /api/updates', () => {
  it('polls at mount and then every UPDATES_POLL_MS (60 s)', async () => {
    expect(UPDATES_POLL_MS).toBe(60_000);
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'updates').mockResolvedValue(view());
    renderHook(() => useUpdatesView());
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(UPDATES_POLL_MS - 1); });
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('starts with nothing, then carries the first good answer', async () => {
    const good = view();
    vi.spyOn(api, 'updates').mockResolvedValue(good);
    const { result } = renderHook(() => useUpdatesView());
    expect(result.current.view).toBeNull();
    expect(result.current.failure).toBeNull();
    await act(async () => {});
    expect(result.current.view).toBe(good);
    expect(result.current.failure).toBeNull();
  });

  it('keeps the newest issued poll authoritative when an older request resolves last', async () => {
    vi.useFakeTimers();
    const first = Promise.withResolvers<UpdatesView>();
    const newer = view({ catalogue: { lastOkAt: 2_000, lastError: null } });
    vi.spyOn(api, 'updates').mockReturnValueOnce(first.promise).mockResolvedValueOnce(newer);

    const { result } = renderHook(() => useUpdatesView());
    await tick();
    expect(result.current.view).toBe(newer);

    await act(async () => { first.resolve(view()); await first.promise; });
    expect(result.current.view).toBe(newer);
    expect(result.current.failure).toBeNull();
  });

  it('keeps it authoritative when an older request REJECTS last — a stale failure is not reported', async () => {
    vi.useFakeTimers();
    const first = Promise.withResolvers<UpdatesView>();
    const newer = view();
    vi.spyOn(api, 'updates').mockReturnValueOnce(first.promise).mockResolvedValueOnce(newer);

    const { result } = renderHook(() => useUpdatesView());
    await tick();
    await act(async () => { first.reject(new TypeError('Failed to fetch')); await first.promise.catch(() => {}); });
    expect(result.current.view).toBe(newer);
    expect(result.current.failure).toBeNull();
  });

  it('reads a 501 not-configured as not-configured, and any other failure as failed', async () => {
    vi.spyOn(api, 'updates').mockRejectedValue(new ApiError(501, { ok: false, error: 'not-configured' }));
    const unconfigured = renderHook(() => useUpdatesView());
    await act(async () => {});
    expect(unconfigured.result.current).toMatchObject({ view: null, failure: 'not-configured' });
    unconfigured.unmount();

    // Two conditions the screen renders differently must not share one value:
    // a 501 carrying another word is not "this box has no control plane".
    vi.spyOn(api, 'updates').mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    const other501 = renderHook(() => useUpdatesView());
    await act(async () => {});
    expect(other501.result.current).toMatchObject({ view: null, failure: 'failed' });
    other501.unmount();

    vi.spyOn(api, 'updates').mockRejectedValue(new ApiError(404, 'Not Found'));
    const older = renderHook(() => useUpdatesView());
    await act(async () => {});
    expect(older.result.current).toMatchObject({ view: null, failure: 'failed' });
  });

  it('keeps the last good view across a failed, a malformed and a 501 poll, and clears the failure on the next good one', async () => {
    vi.useFakeTimers();
    const good = view();
    const fresh = view({ catalogue: { lastOkAt: 9_000, lastError: null } });
    vi.spyOn(api, 'updates')
      .mockResolvedValueOnce(good)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ...good, nodes: {} } as unknown as UpdatesView)
      .mockRejectedValueOnce(new ApiError(501, { ok: false, error: 'not-configured' }))
      .mockResolvedValueOnce(fresh);

    const { result } = renderHook(() => useUpdatesView());
    await act(async () => {});
    expect(result.current.view).toBe(good);
    expect(result.current.failure).toBeNull();

    await tick();
    expect(result.current.view, 'a failed poll never clears the view').toBe(good);
    expect(result.current.failure).toBe('failed');

    await tick();
    expect(result.current.view, 'a malformed answer is a failure, not an empty fleet').toBe(good);
    expect(result.current.failure).toBe('failed');

    await tick();
    expect(result.current.view).toBe(good);
    expect(result.current.failure).toBe('not-configured');

    await tick();
    expect(result.current.view).toBe(fresh);
    expect(result.current.failure).toBeNull();
  });

  it('pollMs <= 0 is the injected mode — no request, no interval, no listener, and reload does nothing', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'updates').mockResolvedValue(view());
    for (const pollMs of [0, -1]) {
      const { result, unmount } = renderHook(() => useUpdatesView(pollMs));
      setVisibility('visible');
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(UPDATES_POLL_MS * 3); });
      act(() => { result.current.reload(); });
      expect(spy, `pollMs ${pollMs}`).not.toHaveBeenCalled();
      expect(result.current.view).toBeNull();
      expect(result.current.failure).toBeNull();
      unmount();
    }
  });

  it('re-polls once when the page becomes visible, and not when it is hidden', async () => {
    const spy = vi.spyOn(api, 'updates').mockResolvedValue(view());
    renderHook(() => useUpdatesView());
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spy).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reload polls once now, lands its answer, and keeps one identity across renders', async () => {
    const fresh = view({ catalogue: { lastOkAt: 3_000, lastError: null } });
    const spy = vi.spyOn(api, 'updates').mockResolvedValueOnce(view()).mockResolvedValueOnce(fresh);
    const { result, rerender } = renderHook(() => useUpdatesView());
    await act(async () => {});
    const reload = result.current.reload;

    await act(async () => { result.current.reload(); });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current.view).toBe(fresh);

    rerender();
    expect(result.current.reload).toBe(reload);
  });

  it('stops the interval and the visibility listener on unmount', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'updates').mockResolvedValue(view());
    const { unmount } = renderHook(() => useUpdatesView());
    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(UPDATES_POLL_MS * 2); });
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the new cases to verify they fail**

`pwa/node_modules` is absent in a fresh workspace; install it first (`test -d pwa/node_modules || (cd pwa && npm ci)`).

Run: `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts`
Expected: FAIL — `Tests  14 failed | 73 passed (87)`: the file holds 72 cases at `d759c914` (counted as `grep -c "\bit("` = 72, no `it.each`; re-measure it from this run's own total rather than trusting the count), and this step adds 15. The file LOADS — a named import of a missing export is `undefined` under vitest's transform, not a SyntaxError — so the reds are per case: the eight client cases on `TypeError: api.updates is not a function` (and `api.setUpdateIntent` / `api.refreshUpdates` / `api.ackUpdateNode is not a function`), the route census on `expected [] to deeply equal [ '\'/api/updates\'', … ]`, `MOVE_DISABLED_TEXT` on `expected undefined to be 'lands with the next release (W4)'`, and four of the five `updateErrorText` cases on `TypeError: updateErrorText is not a function`. The fifth — "the five existing translators pass every update-only code through unchanged" — calls only the EXISTING translators and is GREEN now: it is the disjointness pin, measured before the table exists. If it reds here, an existing table already owns an update word — stop and report it.

Run: `cd pwa && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx`
Expected: FAIL — the file does not load: `Error: Failed to resolve import "../src/fleet/useUpdatesView" from "test/use-updates-view.test.tsx". Does the file exist?`, `Test Files  1 failed (1)`, no test collected.

- [ ] **Step 4: Add the client to `pwa/src/lib/api.ts`**

Replace the import line (`:5`) IN PLACE — one line, the eight names placed in the line's existing alphabetical order:

```ts
import type { AccountsResponse, AckAnswer, AutoMode, CatalogueState, CatchUp, ClaimSummary, CoordCaps, CoordCapsView, FleetHealth, FleetSession, IntentWriteAnswer, LifecycleQueryResult, LoginRequest, NotifyEvent, NotifyMode, PaneHistoryReply, PasskeyAssertFinish, PasskeyAssertStart, PasskeyListResponse, PasskeyRegisterFinish, PasskeyRegisterStart, ProjectPoolWire, ProjectRow, PrView, ReapResult, RouteField, RouteFields, RunSummary, SlashCommand, StagedClip, UpdateChannel, UpdateRouteError, UpdatesView, WsAudit } from '../../../shared/api';
```

Insert after `export const kickoffErrorText = (text: string): string => KICKOFF_ERROR_TEXT[text] ?? text;` (`:294`), before the blank line and `/** Injectable for tests; defaults to the real global fetch. */` (`:295-296`):

```ts

/**
 * The one sentence every move control carries while it is DISABLED (design
 * 2026-09-20 §13, §15 row W3): Install and Roll back on a release row, Update
 * and Roll back on a node row, and the fleet banner's Update all. One literal,
 * so five controls cannot disagree about when they arrive, and the wave that
 * enables them retires one line. This client has no method for either move
 * route, on purpose — `api.test.ts` pins the census of the update routes it
 * spells, so nothing here can be wired to a disabled control early.
 */
export const MOVE_DISABLED_TEXT = 'lands with the next release (W4)';

/**
 * The body of `POST /api/updates/intent` — W2's `INTENT_BODY_KEYS`, and nothing
 * else (its parser refuses an unknown key). A PARTIAL over one scope: an omitted
 * field keeps its stored value, so moving one setting cannot clobber another
 * with a stale reading. `pinnedTag: null` clears a pin; leaving it out keeps it.
 * `scope` is `FLEET_SCOPE` for the fleet default, else a node id.
 */
export interface UpdateIntentRequest {
  scope: string;
  channel?: UpdateChannel;
  pinnedTag?: string | null;
  auto?: AutoMode;
  notify?: NotifyMode;
}

/**
 * The update routes' refusals (W2 Task 13's route table), the sixth code table
 * in this file (after SEND, SUBMIT, UPLOAD, API and KICKOFF) — and the first
 * that is read CODE-FIRST rather than composed after `apiErrorText`
 * (D-3302).
 *
 * WHY NOT `updateText(apiErrorText(err))`, the way `kickoffErrorText` composes.
 * Two of these words already have owners: `not-configured` is `API_ERROR_TEXT`'s
 * kickoff sentence ("does not run coordination — there is no mail store to
 * queue a kickoff into"), which is false on this surface, and `bad-request` is
 * the upload and kickoff tables'. Composed after `apiErrorText`, the update
 * screen would show the kickoff sentence; composed into it, every other surface
 * would show the update one. Read first, against its own keys, each surface
 * says its own thing — and `apiErrorText` is the floor only for a code this
 * table does not own. It consumes no translator's output and no translator
 * consumes its output, so the shadowing the mutual-exclusion suite guards
 * cannot arise here; `api.test.ts` pins the other direction, that the five
 * existing tables pass every update-only word through unchanged.
 *
 * Keyed by W2's union: a word W2 adds to `UpdateRouteError` is a compile error
 * here until it has a sentence. `unauthenticated` is excluded, because a 401
 * raises the login screen through `request()` before any sentence matters.
 * `rate-limited` claims a REQUEST, never a landed answer: the route answers it
 * inside a minute of the poller's last request (`lastRequestAt()`, D-3203),
 * which a failed request and the scheduled poll both set, so `lastOkAt` may
 * still be null — and nothing says "checked" while it is (spec §18).
 */
const UPDATE_ERROR_TEXT: Record<Exclude<UpdateRouteError, 'unauthenticated'>, string> = {
  'not-configured': 'This box has no update control plane — it runs without a coordination database.',
  'bad-tag': 'That is not a release tag — tags look like v0.0.9.',
  'bad-request': 'The server refused the shape of that request — reload the screen and try again.',
  'unknown-scope': 'That node has no identity yet — it follows the fleet setting until an install gives it one.',
  'unknown-node': 'That node is no longer in the inventory.',
  superseded: 'That node was reinstalled under a new identity — reload to see it.',
  busy: 'That node is mid-update — wait for it to settle, then acknowledge.',
  'auto-needs-rollback-gate': 'Auto-install needs the rollback gate on every node, and at least one does not carry it yet.',
  'rate-limited': 'GitHub was asked less than a minute ago — try again in a minute.',
  'no-channel': 'A stored channel is one this build cannot read — choose the channel again.',
  'journal-unreadable': 'The server cannot read its intent journal — nothing was changed.',
  'journal-unwritable': 'The server cannot write its intent journal — nothing was changed.',
};

/** Operator-facing text for a failed update-route call: the code in
 *  `UPDATE_ERROR_TEXT` (OWN keys only — `Object.hasOwn`, so a body naming
 *  `toString` is not a code this table owns), else `apiErrorText`'s answer. */
export function updateErrorText(err: unknown): string {
  if (err instanceof ApiError && typeof err.body === 'object' && err.body !== null) {
    const code = (err.body as { error?: unknown }).error;
    if (typeof code === 'string' && Object.hasOwn(UPDATE_ERROR_TEXT, code)) {
      return UPDATE_ERROR_TEXT[code as keyof typeof UPDATE_ERROR_TEXT];
    }
  }
  return apiErrorText(err);
}
```

Insert directly after `    rebootFleet: () => post('/api/fleet/reboot'),` (`:478`):

```ts
    /** `GET /api/updates` — the control plane read (W2 Task 13): catalogue line,
     *  releases, live nodes, intent rows. `501 not-configured` on a box with no
     *  coordination database. Read through `useUpdatesView`, whose
     *  `asUpdatesView` treats a malformed answer as a failure — the generic
     *  here is the contract, not a proof. */
    updates: () => getJson<UpdatesView>('/api/updates'),
    /** `POST /api/updates/intent` — a PARTIAL over one scope (`UpdateIntentRequest`).
     *
     *  `postJsonOr`, not `postJson` (D-1150), for `setCoordCaps`'s reason: after
     *  an intent WRITE, "the answer could not be read" and "the request never
     *  happened" are different states — the first may well have stored the
     *  channel — so the screen says "unconfirmed" and re-polls rather than
     *  reporting a failure that may not have happened. A refusal still rejects
     *  with its `ApiError`, whose body (`nodes`, `field`, `detail`) the screen
     *  reads. */
    setUpdateIntent: (body: UpdateIntentRequest) =>
      postJsonOr<IntentWriteAnswer | 'unreadable'>('/api/updates/intent', 'unreadable', body),
    /** `POST /api/updates/refresh` — *Check now*. `postJson`: it stores no
     *  operator choice to be unconfirmed about — the answer IS the catalogue
     *  line the screen shows, and an unreadable one is a failed check, which
     *  the next 60 s poll heals. `429 rate-limited {retryAfterS}` inside a
     *  minute of the last check (scheduled or tapped). */
    refreshUpdates: () => postJson<CatalogueState>('/api/updates/refresh'),
    /** `POST /api/updates/ack` — clears a node's failed/reverted state or an
     *  outstanding request. `postJsonOr`, the `setUpdateIntent` argument: an
     *  ack that answered unreadably may already have cleared the row. */
    ackUpdateNode: (nodeId: string) =>
      postJsonOr<AckAnswer | 'unreadable'>('/api/updates/ack', 'unreadable', { nodeId }),
```

- [ ] **Step 5: Create `pwa/src/fleet/useUpdatesView.ts`**

```ts
// The ONE poll of `GET /api/updates` (design 2026-09-20 §13; W3 Task 5), and
// the two pure readers every update surface shares — the settings screen, the
// fleet banner and BuildLine all read THIS file's answers, so none of them can
// hold its own opinion of what "malformed" or "behind" means.
//
// The hook is `useFleetHealth`'s shape — newest issued request authoritative,
// `pollMs <= 0` as the injected mode, one poll per screen handed down — with
// two additions that hook does not need. (1) It keeps the last GOOD view across
// a failed poll and reports the failure BESIDE it rather than instead of it:
// the settings screen must not blank a node list because one read timed out,
// and must not claim the list is fresh either. (2) It re-polls when the page
// becomes visible, because a phone that slept through three polls should not
// show a 3-minute-old "vX is out" as current.
import { useCallback, useEffect, useRef, useState } from 'react';
import { isReleaseTag, isUpdateChannel, type NodeWire, type UpdatesView } from '../../../shared/api';
import { isNewerTag } from '../../../shared/semver';
import { ApiError, api } from '../lib/api';

/** The read's cadence. The spec names none for the PWA; 60 s is the server's
 *  own fastest cadence over these rows — the inventory sweep
 *  (`UPDATE_INVENTORY_MS`, `server/src/watch.ts`, design §9's "every inventory
 *  sweep (60 s)"); the catalogue poll is 30 min — so a faster read would fetch
 *  the same rows again. The visibility refresh covers a phone that slept
 *  through polls. */
export const UPDATES_POLL_MS = 60_000;

/** Why the latest poll produced no view — two words, because the screen says
 *  two different things: `not-configured` is a box with no control plane (a
 *  state, rendered as such), `failed` is a read that did not land (transient). */
export type UpdatesFailure = 'not-configured' | 'failed';

export interface UpdatesPoll {
  /** The LAST GOOD answer — a later failure never clears it. */
  view: UpdatesView | null;
  /** The latest poll's failure; null after a good answer. */
  failure: UpdatesFailure | null;
  /** One poll now (after a write), under the same newest-issued guard. A no-op
   *  in the injected mode: a consumer handed its view re-polls through its parent. */
  reload: () => void;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The wire guard: null unless the answer has the `UpdatesView` SHAPE — a
 * catalogue line whose two fields are what they claim, and three arrays. A
 * malformed answer (a proxy's HTML, a stub `{}`, an older server's other JSON)
 * is a FAILURE the caller reports, never an empty fleet it renders as "nothing
 * to update".
 *
 * The catalogue's FIELDS are checked, not only that it is an object, because
 * every surface decides "checked" on `lastOkAt !== null` and `undefined !==
 * null` is true: `{catalogue: {}}` passing here would render a "checked" line
 * for a catalogue nobody reached (spec §18 "unreachable is not current").
 * Elements are passed through as the wire types — the server is their one
 * writer — and each reader below still tolerates an absent field.
 */
export function asUpdatesView(raw: unknown): UpdatesView | null {
  if (!isObject(raw)) return null;
  const { catalogue, releases, nodes, intent } = raw;
  if (!isObject(catalogue)) return null;
  const { lastOkAt, lastError } = catalogue;
  if (lastOkAt !== null && !(typeof lastOkAt === 'number' && Number.isFinite(lastOkAt))) return null;
  if (lastError !== null
    && !(isObject(lastError) && typeof lastError['at'] === 'number' && typeof lastError['reason'] === 'string')) {
    return null;
  }
  if (!Array.isArray(releases) || !Array.isArray(nodes) || !Array.isArray(intent)) return null;
  return raw as unknown as UpdatesView;
}

/** The node's running tag, or null when there is none to compare: no stamp, an
 *  untagged build, or a `version` that is not a release tag. */
export function nodeVersion(n: NodeWire): string | null {
  const v = n.current?.version;
  return isReleaseTag(v) ? v : null;
}

/**
 * THE ONE ARROW PREDICATE — the tag a node should move UP to, or null. Read by
 * the node inventory (Task 9), the fleet banner (Task 11) and BuildLine's affix
 * (Task 12); none of them compares tags itself.
 *
 * No arrow while the node is UNMEASURED or has NO RESOLVED CHANNEL (spec §18
 * "unreachable is not current"): `typeof … === 'number'` and `isUpdateChannel`
 * rather than `!== null`, so an absent field reads as "don't know", never as
 * measured. No arrow for a desired tag that is not a tag, or not NEWER than the
 * running one — a desired tag below it is a rollback's direction, which is not
 * an update arrow. Newer is `isNewerTag` (semver: `v0.0.10` > `v0.0.9`), after
 * `isReleaseTag` on both sides, because it throws on a non-tag. A node running
 * nothing comparable (unversioned) points at its desired tag.
 */
export function pendingTag(n: NodeWire): string | null {
  if (typeof n.measuredAt !== 'number') return null;
  if (!isUpdateChannel(n.channel)) return null;
  const want = n.desiredTag;
  if (!isReleaseTag(want)) return null;
  const have = nodeVersion(n);
  return have === null || isNewerTag(want, have) ? want : null;
}

/** `not-configured` needs BOTH the status and the code: a 501 carrying any other
 *  word is a read that failed, and folding it into "this box has no control
 *  plane" would overload one value with two conditions the screen renders
 *  differently. */
const failureOf = (err: unknown): UpdatesFailure =>
  err instanceof ApiError && err.status === 501
    && typeof err.body === 'object' && err.body !== null
    && (err.body as { error?: unknown }).error === 'not-configured'
    ? 'not-configured'
    : 'failed';

/**
 * `GET /api/updates` every `pollMs` and whenever the page becomes visible.
 * Newest ISSUED request authoritative — an older in-flight answer, good or bad,
 * never overwrites a newer one (`useFleetHealth`'s issued/mine guard). State is
 * set functionally, so a failure keeps whatever view the previous commit held.
 * `pollMs <= 0` is the injected mode: no request, no interval, no listener.
 */
export function useUpdatesView(pollMs: number = UPDATES_POLL_MS): UpdatesPoll {
  const [state, setState] = useState<{ view: UpdatesView | null; failure: UpdatesFailure | null }>(
    { view: null, failure: null });
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (pollMs <= 0) return undefined;   // an injected consumer never polls
    let live = true;
    let issued = 0;
    const load = (): void => {
      const mine = ++issued;
      void api.updates().then(
        (raw) => {
          if (!live || mine !== issued) return;
          const view = asUpdatesView(raw);
          setState((prev) => (view === null ? { view: prev.view, failure: 'failed' } : { view, failure: null }));
        },
        (err: unknown) => {
          if (!live || mine !== issued) return;
          const failure = failureOf(err);
          setState((prev) => ({ view: prev.view, failure }));
        },
      );
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') load();
    };
    loadRef.current = load;
    load();
    const t = setInterval(load, pollMs);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      loadRef.current = () => {};
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pollMs]);

  const reload = useCallback(() => { loadRef.current(); }, []);
  return { view: state.view, failure: state.failure, reload };
}
```

- [ ] **Step 6: Run the suites to verify they pass**

Run: `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts test/use-updates-view.test.tsx`
Expected: PASS — `Test Files  2 passed (2)`; `api.test.ts` `87 passed (87)` (72 before + 15), `use-updates-view.test.tsx` `19 passed (19)`.

Run: `cd pwa && npm run build`
Expected: exit 0 — `tsc --noEmit` compiles `src` and `test` (both test files included: the `Record<Exclude<UpdateRouteError, 'unauthenticated'>, string>` fixture and table, the full `NodeWire` fixtures) and `vite build` writes `../server/dist-pwa`.

Run: `cd pwa && ./node_modules/.bin/vitest run`
Expected: PASS — the whole pwa suite (no other file reads either new name; this is the "no suite list is enough" gate for the package). It includes the scans that walk `pwa/src` for a shape rather than a name — in particular `mail-strip.test.tsx`'s describe `'lastError is consumed as free text, or not at all'`, whose two regexes forbid `[x.lastError]` and `{x.lastError}`: `asUpdatesView` destructures `lastError` into a local and reads `lastError['at']`/`lastError['reason']`, neither shape, so it stays green; spell the guard as `catalogue.lastError` inside braces or brackets and it reds.

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts`
Expected: PASS — `single-definition` walks `pwa/src` from the filesystem, untracked files included (W2 Task 1's `update control plane` describe included: `useUpdatesView.ts` declares none of W2's type names and imports every guard it uses; neither new source holds a hand-typed SQL tuple of any vocabulary). `topology-clean` is NOT run here — its corpus is `git ls-files`, which cannot see the two untracked new files yet; it runs in Step 8, after `git add`.

- [ ] **Step 7: Mutation measurement**

Each edit below is made with the Edit tool on the named line and reversed the same way — never `git checkout --` (a checkout restore eats the uncommitted work of this task). After the last reversal, `git status --short` names exactly the four paths of Step 8 (two ` M`, two `??` — `git diff --stat` alone cannot see the two new files) and Step 6's first command is green again.

1. Spec §18 "unreachable is not current" — the predicate's half. In `pendingTag` (`pwa/src/fleet/useUpdatesView.ts`) delete the line `  if (typeof n.measuredAt !== 'number') return null;`. Run `cd pwa && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx -t 'unmeasured'` → FAIL: `expected 'v0.0.10' to be null` at "draws no arrow while the node is unmeasured". Re-insert the line; re-run → PASS.
2. The same row — the catalogue's half. In `asUpdatesView` delete the line `  if (lastOkAt !== null && !(typeof lastOkAt === 'number' && Number.isFinite(lastOkAt))) return null;`. Run `cd pwa && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx -t 'two-field line'` → FAIL at the `lastOkAt absent` assertion (`lastOkAt absent: expected { catalogue: { lastError: null }, … } to be null`) — `catalogue: {}` stays null through the `lastError` check, which is why the absent-`lastOkAt` case exists beside it. Re-insert; re-run → PASS.
3. Spec §18 "the move controls are disabled in W3" — the client half. Insert `    applyUpdate: (tag: string) => postJson<unknown>('/api/updates/apply', { tag }),` after the `ackUpdateNode` method in `pwa/src/lib/api.ts`. Run `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts -t 'exactly the four W2 update routes'` → FAIL: the census gains `'/api/updates/apply'`. Delete the line; re-run → PASS.
4. The newest-issued guard (Review Focus 4's hook half). In `useUpdatesView`'s success arm change `if (!live || mine !== issued) return;` to `if (!live) return;` — the line is spelled twice, so the Edit's `old_string` carries the line above it, `        (raw) => {`, to be unique. Run `cd pwa && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx -t 'older request resolves last'` → FAIL: `expected { …lastOkAt: 1000… } to be { …lastOkAt: 2000… }`. Restore; then make the same change in the rejection arm (`old_string` anchored on `        (err: unknown) => {`) → `cd pwa && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx -t 'REJECTS last'` FAILS with `expected 'failed' to be null`. Restore; re-run → PASS.
5. The keep-last-view rule. In the success arm change `{ view: prev.view, failure: 'failed' }` to `{ view: null, failure: 'failed' }`. Run `cd pwa && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx -t 'keeps the last good view'` → FAIL: `a malformed answer is a failure, not an empty fleet: expected null to be { … }`. Restore; re-run → PASS.
6. Semver, not string order. In `pendingTag` change `isNewerTag(want, have)` to `want > have`. Run `cd pwa && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx -t 'semver order'` → FAIL: `expected null to be 'v0.0.10'`. Restore; re-run → PASS.
7. `postJsonOr` is the write's helper. In `setUpdateIntent` change `postJsonOr<IntentWriteAnswer | 'unreadable'>('/api/updates/intent', 'unreadable', body)` to `postJson<IntentWriteAnswer | 'unreadable'>('/api/updates/intent', body)`. Run `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts -t 'may have landed'` → FAIL: the promise rejects with a `SyntaxError` instead of resolving `'unreadable'`. Restore; re-run → PASS.
8. Code-first, not composed (D-3302). Replace `updateErrorText`'s body with `return apiErrorText(err);` alone. Run `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts -t 'update sentence, not the kickoff one'` → FAIL: `expected 'This box does not run coordination — …' to be 'This box has no update control plane — …'`. Restore; re-run → PASS.
9. The `not-configured` word needs its code (interface correction 3). In `failureOf` delete the line `    && (err.body as { error?: unknown }).error === 'not-configured'`. Run `cd pwa && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx -t 'reads a 501'` → FAIL: `expected { view: null, failure: 'not-configured' } to match object { view: null, failure: 'failed' }`. Restore; re-run → PASS.
10. The table is keyed by W2's union. Delete the `  'no-channel': …` line from `UPDATE_ERROR_TEXT`. Run `cd pwa && npm run build` → FAIL: `error TS2741: Property '"no-channel"' is missing in type` (lib/api.ts), and `cd pwa && ./node_modules/.bin/vitest run test/api.test.ts -t 'every UpdateRouteError'` → FAIL on `no-channel`. Restore; re-run both → PASS.

- [ ] **Step 8: Commit**

```bash
git add pwa/src/lib/api.ts pwa/src/fleet/useUpdatesView.ts pwa/test/api.test.ts pwa/test/use-updates-view.test.tsx
# The index now holds the two new files, so topology-clean's `git ls-files` corpus reaches them — expected PASS.
(cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts)
git commit -m "feat(update): the PWA's update-plane client and its one poll — updates/setUpdateIntent/refreshUpdates/ackUpdateNode, a code-first updateErrorText, MOVE_DISABLED_TEXT, useUpdatesView and the one arrow predicate pendingTag"
```

### Task 6: The `/settings` route and its door

**Files:**
- Modify: `pwa/src/app.tsx` — `import { SettingsScreen } from './screens/SettingsScreen';` directly after `import { SessionScreen } from './screens/SessionScreen';` (`:25` — the import block is alphabetical, and `Session…` sorts before `Settings…`); `const settings = /^\/settings\/?$/.test(path);` after `const runs = /^\/runs\/?$/.test(path);` (`:69`); `|| settings` appended to the `data-view` chain (`:116`); one rung `) : settings ? (` / `<SettingsScreen />` after the `runs` rung (`:144-145`), before the fallback `) : (` (`:146`). `app.tsx` is cited by no document in the session-hook audit's corpus (`server/test/session-hook.test.ts:4639-4643`'s `CORPUS`: the compaction-card spec, its plan A and `README.md` — measured at `d759c914`: no `app.tsx:<digits>` token in any of the three, nor in `CLAUDE.md`, nor a `<file>:<digits>` token for any other file this task edits, nor one in `pwa/test` or `server/test`), so no insert in this task need be line-neutral (rulings R13)
- Create: `pwa/src/screens/SettingsScreen.tsx` — the SHELL only: `div.settings-screen` > `header.settings-head` (the back chevron `button.settings-back`, `aria-label="Back to fleet"`, `navigate('/')`; `h1.settings-title` `Settings`); imports `'../fleet/fleet.css'`; Tasks 7–10 fill its body (the shell lands here because the route's pin needs its heading)
- Modify: `pwa/src/screens/FleetScreen.tsx` — the door directly after the `.accounts-door` button (`:559-567`), before `<MailBadge unread={unreadMail} />` (`:568`), with its own comment carrying the `.accounts-door` discoverability argument (`:543-558`). Inserts 22 lines above `:573` (`<FleetHostBanner health={fleetHealth} />`) and `:932` (`<BuildLine …/>`): Tasks 11 and 12 anchor those two sites by QUOTED text, never by these line numbers
- Modify: `pwa/src/fleet/fleet.css` — appended after the last line (`:2943` at `d759c914`, `.hotfiles-path`): `/* — centralised update management W3: SettingsScreen … — */`, `.settings-screen`, `.settings-head`, `.settings-back` (+ `:active`), `.settings-title` (the `.accounts-*` shape, `:2202-2226`), `.settings-door` (+ `:active`), `.settings-door-glyph` (the `.accounts-door` shape, `:2363-2375`), and ONE override `.fleet-head > .fleet-head-right { flex-wrap: wrap; justify-content: flex-end; row-gap: 0; }` (D-3303)
- Modify: `pwa/design/audit.mjs` — five `INHERITED_GROUNDS` entries (`'fleet.css .settings-back'`, `'fleet.css .settings-back:active'`, `'fleet.css .settings-title'`, `'fleet.css .settings-door'`, `'fleet.css .settings-door:active'`), each `under: ['var(--bg-page)']`, inserted directly before `INHERITED_GROUNDS`' closing `};` (`:746` at `d759c914`, after `'fleet.css .build-line-side--warn'`'s entry) (D-3304)
- Test: `pwa/test/app.test.tsx` — `describe('App /settings route')` inserted after the `/runs` pin (`:116-123`); `pwa/test/fleet-screen.test.tsx` — one describe APPENDED after the file's last line (`:2606` at `d759c914`), with its own `afterEach(() => navigate('/'))` (the file-level `afterEach`, `:26-30`, does not reset the route — the `archived footer row` describe, `:1922-1923`, is the precedent); `pwa/test/settings-screen.test.tsx` (create) — imports, the full `afterEach` (`accounts-screen.test.tsx:46-51`), the heading, the back control, the tap-floor scrapes (`.settings-back`, `.settings-door` `min-height: var(--tap-min)`) and the head-wrap scrape; `pwa/test/contrast.test.ts` — one describe APPENDED after the file's last line (`:1843` at `d759c914`): the door's ink measured on the desktop sidebar's `--bg-surface` beside its `--bg-page` registration, and the shell's three rules registered rather than in the census
- Run, not modified: `pwa/test/fleet-css.test.ts` (the sheet-wide scans, incl. `repeat(n, 1fr)`), `pwa/test/fleet-class-chooser.test.tsx` (`.fleet-head .fleet-head-right` still renders), `pwa/test/auth-door.test.tsx` (the `.accounts-door` case, unchanged), `pwa/test/sw-denylist.test.ts` (`/settings` already answers with the shell, `:45-50`), `pwa/test/tap-targets.test.tsx` (renders FleetScreen; no query of its matches the door), `node design/contrast-check.mjs`, `npm run build`, `server/test/topology-clean.test.ts` (two new files)

**Interfaces:**
- Consumes: `navigate`, `usePath` (`pwa/src/lib/router.ts:17-42`); the D-161 pane reset (`app.tsx:105-111`, keyed on `path` — nothing to add); `declValue`, `ruleIn` (`pwa/test/cssRule.ts:98`, `:139`); `INHERITED_GROUNDS`, `rulesOf`, `ruleKey`, `declOf`, `ratio`, `audit`/`report`, `loadThemes`/`DARK`/`LIGHT` (`pwa/design/audit.mjs`, already imported and bound at `contrast.test.ts:6-33`, `:388-389`); the frozen uncovered census `GRANDFATHERED_UNCOVERED` (`contrast.test.ts:119`, D-2689: "an added identity must be measured or explicitly registered before it ships"); the SPA fallback that already serves `/settings` (`server.ts:3287-3292`, the SW's `swDenylist` at `sw-denylist.test.ts:45-50`) — a deep link or a push tap to `/settings` needs no server or SW change.
- Produces:

```tsx
// pwa/src/screens/SettingsScreen.tsx
export function SettingsScreen(): ReactNode;
// the door, in .fleet-head-right:
<button type="button" className="settings-door" aria-label="Settings — updates and notifications"
  onClick={() => navigate('/settings')}>
  <span className="settings-door-glyph" aria-hidden="true">⚙</span>
  Settings
</button>
```

- Pins: `navigate('/settings'); render(<App />)` → `getByRole('heading', { name: /^settings$/i })` present AND `.app-shell` `data-view="session"` (spec §13 Pins; mutation: drop `|| settings` from the chain → red on `data-view`; drop the rung → red on the heading). The door: a button named `Settings — updates and notifications` inside `.fleet-head-right`, carrying `settings-door`, with a visible text label, whose click lands on `/settings` (mutation: point it at `/accounts` → red). The CSS: `.settings-back` and `.settings-door` on `--tap-min`; the head's right group wraps by out-specifying `.fleet-head-right` (mutation: delete `flex-wrap: wrap;` → red). The contrast census: no `.settings-*` rule enters `report.uncovered` (mutation: delete the `.settings-door` entry → red, and the gate's uncovered count rises 255 → 256, measured on a copy of `pwa/` at `d759c914`).
- Corrections to the skeleton, carried above: (1) the import goes after `SessionScreen`'s (`:25`), not `RunsScreen`'s (`:24`) — alphabetical; (2) the task also edits `pwa/design/audit.mjs` and `pwa/test/contrast.test.ts` — MEASURED on a copy of `pwa/` at `d759c914` with this task's CSS appended and no registry entry, `node design/contrast-check.mjs --uncovered` lists exactly `fleet.css .settings-back`, `.settings-back:active`, `.settings-title`, `.settings-door`, `.settings-door:active` and the count reads 260 (255 before), which reds `contrast.test.ts`'s "contains no identities beyond the grandfathered blind spots" (`:1160-1166`); with the five entries the gate reads `ALL 572 PASS` (562 before), 255 uncovered, 0 problems; (3) the door cannot join `.fleet-head-right` without the wrap override — see D-3303; (4) the fleet-screen case needs its own route reset.

- [ ] **Step 1: Record the baselines**

`pwa/node_modules` is absent on a fresh workspace; install it once (`cd pwa && npm ci`), then run each file this task extends, unchanged, and write down its count — the green runs in Step 9 are compared against these, because a smaller green is not the same green:

Run: `cd pwa && ./node_modules/.bin/vitest run test/app.test.tsx test/fleet-screen.test.tsx test/contrast.test.ts` (foreground, timeout ≥ 600000 ms)
Expected: PASS for all three; record the per-file `✓ test/<file> (N tests)` counts as `N_app`, `N_fleet`, `N_contrast`.

Run: `cd pwa && node design/contrast-check.mjs | tail -1; node design/contrast-check.mjs --uncovered | grep -c '^#   '`
Expected: `ALL 562 PASS` and `255`.

- [ ] **Step 2: Write the failing route pin in `pwa/test/app.test.tsx`**

Insert directly after the `/runs` describe's closing `});` (`:123`), before the blank line and the `// T9-R2` comment block (`:125`):

```tsx

describe('App /settings route', () => {
  it('renders SettingsScreen and joins [data-view="session"] like every other non-fleet route', () => {
    // Spec §13 names this pin, and this file's /archive warning is why it has
    // two halves: a route left out of the data-view chain still renders on a
    // desktop (.shell-detail is always shown there) and is HIDDEN behind the
    // fleet sidebar on a phone. The heading catches a missing ternary rung;
    // the attribute catches a missing `|| settings`.
    navigate('/settings');
    render(<App />);
    expect(screen.getByRole('heading', { name: /^settings$/i })).toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-view', 'session');
  });
});
```

- [ ] **Step 3: Write the failing door case in `pwa/test/fleet-screen.test.tsx`**

APPEND after the file's last line (`:2606`). `navigate` (`:8`), `fireEvent`, `render`, `screen` (`:2`), `afterEach` (`:1`) and `makeStore` (`:93-104`) are already in scope:

```tsx

// ── centralised update management W3, Task 6: the door to /settings ─────────
//
// The `.accounts-door` pin's twin (auth-door.test.tsx:176-190): the door is
// only ever useful where it is mounted, so it is found INSIDE the screen that
// hosts it, in the header's control cluster, with a visible word beside the
// glyph — an icon-only gear would be as undiscoverable as the strip D-161
// replaced. The file-level afterEach does not reset the route, so this
// describe does, like `archived footer row` above.
describe('the door to /settings (centralised update management §13)', () => {
  afterEach(() => navigate('/'));

  it('sits in the fleet header, says what it is, and routes to /settings', () => {
    render(<FleetScreen store={makeStore()} />);
    const door = screen.getByRole('button', { name: 'Settings — updates and notifications' });
    expect(door.closest('.fleet-head-right')).not.toBeNull();
    expect(door).toHaveClass('settings-door');
    expect(door.textContent).toMatch(/settings/i);
    fireEvent.click(door);
    expect(location.pathname).toBe('/settings');
  });
});
```

- [ ] **Step 4: Create the failing `pwa/test/settings-screen.test.tsx`**

```tsx
// SettingsScreen (route `/settings`, centralised update management W3 — design
// 2026-09-20 §13). Task 6 lands the SHELL — the header and its back control —
// because the route's own pin (app.test.tsx) needs the screen's heading; Tasks
// 7–10 append one describe each for the sections they add, merging their
// names into the import lines below.
//
// The idiom is accounts-screen.test.tsx's: the FULL afterEach (:46-51) —
// cleanup, restoreAllMocks, the route back to '/', and the fleet store reset —
// because a later section spies on `api` and reads the store, and dropping any
// one of the four leaks state into the next case. CSS is asserted by scraping
// fleet.css through test/cssRule.ts: vitest runs with `css: false`, so jsdom
// evaluates no stylesheet and no computed style can carry a claim.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { declValue, ruleIn } from './cssRule';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

describe('SettingsScreen — the shell', () => {
  it('titles itself Settings, as the one level-1 heading', () => {
    render(<SettingsScreen />);
    expect(screen.getByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument();
  });

  it('has a back affordance that returns to the fleet', () => {
    // Starts ON /settings, so the assertion cannot pass by the route never
    // having moved (accounts-screen.test.tsx's own back case starts on '/').
    navigate('/settings');
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /back to fleet/i }));
    expect(location.pathname).toBe('/');
  });
});

describe('SettingsScreen — tap targets and the header door', () => {
  it('.settings-back is at least one tap square, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.settings-back'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(fleetCss, '.settings-back'), 'min-width')).toBe('var(--tap-min)');
  });

  it('.settings-back is the class the rendered back button carries', () => {
    render(<SettingsScreen />);
    expect(screen.getByRole('button', { name: /back to fleet/i })).toHaveClass('settings-back');
  });

  it('.settings-door is at least one tap tall, off the shared token', () => {
    // The render half — a real element still carries the class — is the
    // fleet-screen.test.tsx door case, where the door is mounted.
    expect(declValue(ruleIn(fleetCss, '.settings-door'), 'min-height')).toBe('var(--tap-min)');
  });

  it("wraps the fleet head's right group rather than overflowing it, by specificity", () => {
    // D-3303: the group's four steady-state items
    // leave ~38px at 390px (fleet.css's Chromium-measured width note above
    // `.fleet-runs-line`), and a fifth, labelled door cannot fit that. The
    // override must OUT-SPECIFY `.fleet-head-right` rather than restate it —
    // the cascade trap fleet-css.test.ts documents at the class chooser.
    const spec = (sel: string): number =>
      (sel.match(/\.[A-Za-z0-9_-]+|\[[^\]]*\]|:[a-z-]+/g) ?? []).length;
    const override = ruleIn(fleetCss, '.fleet-head > .fleet-head-right');
    expect(declValue(override, 'flex-wrap')).toBe('wrap');
    expect(declValue(override, 'justify-content')).toBe('flex-end');
    expect(spec('.fleet-head > .fleet-head-right')).toBeGreaterThan(spec('.fleet-head-right'));
    // Non-vacuity: wrapping means something only on a flex container, and the
    // base rule must still be the one that makes it one.
    expect(declValue(ruleIn(fleetCss, '.fleet-head-right'), 'display')).toBe('flex');
  });
});
```

- [ ] **Step 5: Write the failing contrast case in `pwa/test/contrast.test.ts`**

APPEND after the file's last line (`:1843`). `INHERITED_GROUNDS`, `rulesOf`, `ruleKey`, `declOf`, `ratio` (`:6-33`), `ROOT` (`:55`), `report`, `DARK`, `LIGHT` (`:388-389`) are already in scope:

```ts

// ── centralised update management W3, Task 6: the /settings shell and its door ──
// D-2689 froze the uncovered census, so every colour rule this task adds is
// REGISTERED (design/audit.mjs) rather than left to join it. The shell's three
// sit on .shell-detail, which paints nothing: one ground, --bg-page. The door
// has two — the page on a phone, .shell-nav's --bg-surface in the desktop
// sidebar — and a registration is one layer stack, so it is registered on the
// page (the .pool-epoch-lag entry's ground, same header) and the SECOND ground
// is measured here off the rule's own declared ink, so a retint re-measures
// both. `.accounts-door` beside it stays in the census as pre-existing debt,
// pinned above; this is not a licence to move it and not a copy of its choice.
describe('the /settings shell and its door are measured, not left in the blind spot', () => {
  const fleetRules = rulesOf(ROOT, 'src/fleet/fleet.css');
  const inkOf = (key: string): string => {
    const rule = fleetRules.find((r) => ruleKey(r) === key);
    expect(rule, key).toBeDefined();
    const ink = declOf((rule as { body: string }).body, 'color');
    expect(ink, key).not.toBeNull();
    return ink as string;
  };

  it.each([
    ['fleet.css .settings-back'],
    ['fleet.css .settings-back:active'],
    ['fleet.css .settings-title'],
    ['fleet.css .settings-door'],
    ['fleet.css .settings-door:active'],
  ])('%s is registered on the page and measured in both themes', (key) => {
    expect(INHERITED_GROUNDS[key]?.under).toEqual(['var(--bg-page)']);
    expect(report.uncovered).not.toContain(key);
    const rows = report.measured.filter((m) => m.label.endsWith(key));
    expect(rows, key).toHaveLength(2);                    // dark and light
    for (const row of rows) {
      expect(row.detail, row.label).toContain(`${inkOf(key)} on var(--bg-page)`);
      expect(row.ratio, row.label).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ['fleet.css .settings-door'],
    ['fleet.css .settings-door:active'],
  ])('%s also clears AA on the desktop sidebar it sits on', (key) => {
    // Measured at d759c914 with this task's rules: --ink-secondary 8.67 dark /
    // 7.41 light, --ink-primary 15.68 / 16.58 on --bg-surface.
    for (const theme of [DARK, LIGHT]) {
      expect(ratio(inkOf(key), ['var(--bg-surface)'], theme), key).toBeGreaterThanOrEqual(4.5);
    }
  });
});
```

- [ ] **Step 6: Run the new cases to verify they fail**

Run: `cd pwa && ./node_modules/.bin/vitest run test/app.test.tsx test/fleet-screen.test.tsx test/settings-screen.test.tsx test/contrast.test.ts` (foreground)
Expected: FAIL, and only in the new cases:
- `app.test.tsx` › `App /settings route` — `TestingLibraryElementError: Unable to find an accessible element with the role "heading" and name `/^settings$/i`` (the path falls to the `Select a session` placeholder); the other `N_app` cases pass.
- `fleet-screen.test.tsx` › `the door to /settings …` — `Unable to find an accessible element with the role "button" and name "Settings — updates and notifications"`; the other `N_fleet` cases pass.
- `settings-screen.test.tsx` — the file fails to load: `Failed to resolve import "../src/screens/SettingsScreen" from "test/settings-screen.test.tsx". Does the file exist?`, no test collected.
- `contrast.test.ts` › the five `… is registered on the page …` cases — `expected undefined to deeply equal [ 'var(--bg-page)' ]`; the two sidebar cases — `expected undefined to be defined` from `inkOf` (no such rule yet); the other `N_contrast` cases pass.

- [ ] **Step 7: Create `pwa/src/screens/SettingsScreen.tsx` and wire the route**

Create `pwa/src/screens/SettingsScreen.tsx`:

```tsx
// Settings screen (route `/settings`, centralised update management W3 —
// design 2026-09-20 §13). Two sections and no more — Updates (the channel,
// auto-install, *Check now*, the catalogue line, the release list, the node
// inventory) and Notifications (the bell, release notifications, the
// unarmed-exposure banner) — which Tasks 7–10 of the W3 plan add below the
// header. This task lands the shell alone, because the route's pin
// (app.test.tsx) needs the screen's own heading.
//
// The AccountsScreen skeleton, class for class (`.settings-screen/-head/-back/
// -title`, fleet.css): a back chevron that returns to the fleet, then the <h1>.
// It adds no scroll logic of its own — the D-161 pane reset in app.tsx puts
// `.shell-detail` back at the top on every route change, this one included.
import type { ReactNode } from 'react';
import { navigate } from '../lib/router';
import '../fleet/fleet.css';

export function SettingsScreen(): ReactNode {
  return (
    <div className="settings-screen">
      <header className="settings-head">
        <button type="button" className="settings-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </button>
        <h1 className="settings-title">Settings</h1>
      </header>
    </div>
  );
}
```

In `pwa/src/app.tsx`, replace

```tsx
import { SessionScreen } from './screens/SessionScreen';
```

with

```tsx
import { SessionScreen } from './screens/SessionScreen';
import { SettingsScreen } from './screens/SettingsScreen';
```

replace

```tsx
  const runs = /^\/runs\/?$/.test(path);
```

with

```tsx
  const runs = /^\/runs\/?$/.test(path);
  const settings = /^\/settings\/?$/.test(path);
```

replace

```tsx
      <div className="app-shell" data-view={sessionId || archive || accounts || mail || runs ? 'session' : 'fleet'}>
```

with

```tsx
      <div className="app-shell" data-view={sessionId || archive || accounts || mail || runs || settings ? 'session' : 'fleet'}>
```

and replace

```tsx
          ) : runs ? (
            <RunsScreen />
          ) : (
```

with

```tsx
          ) : runs ? (
            <RunsScreen />
          ) : settings ? (
            <SettingsScreen />
          ) : (
```

- [ ] **Step 8: Add the door, the CSS and the registrations**

In `pwa/src/screens/FleetScreen.tsx`, replace

```tsx
            <span className="accounts-door-glyph" aria-hidden="true">🔑</span>
            Account
          </button>
          <MailBadge unread={unreadMail} />
```

with

```tsx
            <span className="accounts-door-glyph" aria-hidden="true">🔑</span>
            Account
          </button>
          {/* THE DOOR TO /settings (centralised update management §13) — the
              `.accounts-door` pattern directly above, for the argument its
              comment makes: a glyph AND a short text label, because an
              icon-only gear would be exactly as undiscoverable as the
              AccountsStrip tap target that D-161 found was the only door to
              /accounts. The accessible name says what is behind it — updates
              and notifications — because "Settings" alone names no content;
              it begins with the visible word, so a voice user saying what
              they see still reaches it. Rendered unconditionally: a first-run
              fleet with no sessions needs the screen as much as any. A fifth
              item does not fit this group's measured width budget on a
              phone, so the group now wraps rather than overflowing
              (fleet.css, D-3303). */}
          <button
            type="button"
            className="settings-door"
            aria-label="Settings — updates and notifications"
            onClick={() => navigate('/settings')}
          >
            <span className="settings-door-glyph" aria-hidden="true">⚙</span>
            Settings
          </button>
          <MailBadge unread={unreadMail} />
```

APPEND to `pwa/src/fleet/fleet.css`, after its last line (`.hotfiles-path { … }`):

```css

/* — centralised update management W3: SettingsScreen (design 2026-09-20 §13) —
   The AccountsScreen skeleton, class for class. `.settings-screen` paints NO
   background of its own, and neither does `.shell-detail`, so every rule
   here that sets a colour sits on body's --bg-page and is registered on that
   ground in design/audit.mjs's INHERITED_GROUNDS (the `.mail-chip` /
   `.pool-epoch-lag` reasoning) — the uncovered census is frozen (D-2689).
   Tasks 7-10 append the screen's sections after this block. */
.settings-screen { display: grid; gap: var(--sp-3); padding: var(--sp-2); }
.settings-head { display: flex; align-items: center; gap: var(--sp-2); }
/* Same visual contract as `.accounts-back` (and chat.css's `.chat-back`) — a
   rule of its own rather than a shared class, for the reason `.accounts-back`
   gives: two screens with one shape are not one thing. */
.settings-back {
  flex: none;
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  border: none;
  background: none;
  border-radius: var(--r-sm);
  font: var(--weight-regular) 26px / 1 var(--font-ui);
  color: var(--ink-secondary);
  cursor: pointer;
  transition: transform var(--dur-press) var(--ease-swift), color var(--dur-fast) var(--ease-swift);
}
.settings-back:active { transform: scale(0.88); color: var(--ink-primary); }
.settings-title {
  font: var(--weight-medium) var(--text-base) / var(--leading-tight) var(--font-mono);
  color: var(--ink-primary);
}
/* — The door to /settings, in the fleet header beside `.accounts-door` —
   The `.accounts-door` box exactly: the 44px floor, no background, the same
   ink as its neighbours, a TEXT label (FleetScreen.tsx says why). Its ground
   is two — the page on a phone, `.shell-nav`'s --bg-surface in the desktop
   sidebar — and unlike `.accounts-door` it is REGISTERED, on the page
   (design/audit.mjs; the `.pool-epoch-lag` entry, same header, is the
   precedent), because the frozen census admits no new identity; the sidebar
   ground is measured off this rule's own ink in contrast.test.ts, so neither
   ground is claimed without a number (D-3304). */
.settings-door {
  display: inline-flex; align-items: center; gap: 5px;
  min-height: var(--tap-min); padding: 0 var(--sp-1);
  border: 0; border-radius: var(--r-sm);
  background: none; color: var(--ink-secondary);
  font: var(--weight-medium) var(--text-2xs) / 1 var(--font-mono);
  cursor: pointer;
  transition: transform var(--dur-press) var(--ease-swift), color var(--dur-fast) var(--ease-swift);
}
.settings-door:active { transform: scale(0.88); color: var(--ink-primary); }
/* The glyph is decoration beside the word — aria-hidden in the markup, sized
   in the UI font, as `.accounts-door-glyph` is. */
.settings-door-glyph { font-family: var(--font-ui); font-size: var(--text-xs); line-height: 1; }
/* THE HEAD'S RIGHT GROUP WRAPS (D-3303). The width
   note above `.fleet-runs-line` is a Chromium measurement: the group's four
   steady-state items need 244px of min-content and have 294px at 390px, so
   ~38px is left once a fifth item's 12px gap is paid. The labelled door —
   glyph, "Settings" in 11px mono, padding: ~80px by the tokens, an ESTIMATE
   and not a measurement — cannot fit that, and nor could a glyph-only door at
   the 44px floor. Without this rule the head would push the fleet screen past
   the viewport, the defect #116 shipped. With it, a group that does not fit
   breaks onto a second right-aligned line, and where it fits nothing moves.
   The descendant form out-specifies `.fleet-head-right` (0,2,0 against
   0,1,0), so it wins from any position — the cascade trap documented at the
   class chooser. No row gap: every control on the group is already a 44px
   box. */
.fleet-head > .fleet-head-right { flex-wrap: wrap; justify-content: flex-end; row-gap: 0; }
```

In `pwa/design/audit.mjs`, directly before `INHERITED_GROUNDS`' closing `};` (`:746` at `d759c914`, after the `'fleet.css .build-line-side--warn'` entry):

```js
  // ── centralised update management W3, Task 6: the /settings shell and its door ──
  'fleet.css .settings-back': {
    under: ['var(--bg-page)'],
    why: "SettingsScreen's back chevron, in .settings-head inside .settings-screen inside .shell-detail — none of the three paints a background, so body's --bg-page (styles/base.css:111) is behind it, the .mail-chip reasoning. Its selector names no painted ancestor, so no route could ground it; .accounts-back, its twin, is grandfathered debt, and the frozen census admits no new identity (D-2689)",
  },
  'fleet.css .settings-back:active': {
    under: ['var(--bg-page)'],
    why: 'the pressed state of the same chevron, same ground. Registered separately for the reason the .mail-chip[data-on] entry states: it overrides `color` directly, and grounding only the base rule would leave the state a tap confirms unmeasured',
  },
  'fleet.css .settings-title': {
    under: ['var(--bg-page)'],
    why: "the screen's own <h1> beside the chevron, on the same unpainted .settings-head, so the same --bg-page ground and the same reason as .settings-back",
  },
  'fleet.css .settings-door': {
    under: ['var(--bg-page)'],
    why: "the fleet header's door to /settings, in .fleet-head-right beside .accounts-door and .pool-epoch-lag. .fleet, .fleet-head and .fleet-head-right paint nothing, so on a phone the ground is body's --bg-page — the .pool-epoch-lag entry's ground and reasoning. On the desktop sidebar it is .shell-nav's --bg-surface instead, which one layer stack cannot also say; contrast.test.ts measures this rule's own ink on that second ground in both themes, so this registration is not the whole claim",
  },
  'fleet.css .settings-door:active': {
    under: ['var(--bg-page)'],
    why: 'the pressed state of the same door, with the same two grounds and the same second measurement in contrast.test.ts; registered separately because it overrides `color` directly (the .mail-chip[data-on] reason)',
  },
```

- [ ] **Step 9: Run green, then the neighbours and the gates**

Run: `cd pwa && ./node_modules/.bin/vitest run test/app.test.tsx test/fleet-screen.test.tsx test/settings-screen.test.tsx test/contrast.test.ts` (foreground)
Expected: PASS — `app.test.tsx` `N_app + 1`, `fleet-screen.test.tsx` `N_fleet + 1`, `settings-screen.test.tsx` `6`, `contrast.test.ts` `N_contrast + 7` (five registration rows, two sidebar rows).

Run: `cd pwa && ./node_modules/.bin/vitest run test/fleet-css.test.ts test/fleet-class-chooser.test.tsx test/auth-door.test.tsx test/sw-denylist.test.ts test/tap-targets.test.tsx`
Expected: PASS, each at its unchanged count (no case in these files is edited; the door adds no accessible name any of their queries matches — measured by grep at `d759c914`: no test queries `/settings/i`, `/update/i` or `/notif/i` against a rendered FleetScreen).

Run: `cd pwa && node design/contrast-check.mjs | tail -1; node design/contrast-check.mjs --uncovered | grep -c '^#   '; node design/contrast-check.mjs --uncovered | grep -c '^#   .*settings-'`
Expected: `ALL 572 PASS` (562 + the five entries × two themes), `255` (unchanged), `0` (the `--uncovered` listing also prints every PASS row, so the census lines are the `#   ` ones only). Measured: this step's exact CSS and entries applied to a copy of `pwa/` at `d759c914` printed these three values, exit 0, no problem, and the five registration rows and two sidebar ratios of Step 5 evaluated in plain node against the same copy (`8.67/7.41` and `15.68/16.58` on `--bg-surface`).

Run: `cd pwa && npm run build`
Expected: `tsc --noEmit` clean (the test file's `vi` and `act` are used by the `afterEach`; no unused import), then the Vite build.

- [ ] **Step 10: Mutation measurement**

Each mutation is one hand edit, the named case run red, then the edit reversed BY HAND (never `git checkout --`, which would discard this task's uncommitted work) and the restore confirmed by the `grep -c` given, which must print `1`. Run the named file from `pwa/` with `./node_modules/.bin/vitest run test/<file>`.

1. Spec §13's pin, the phone half — in `app.tsx`, change `runs || settings ? 'session'` to `runs ? 'session'` → RED: `app.test.tsx` › `App /settings route` (`expected element to have attribute data-view="session"`, received `"fleet"`); the heading assertion before it passes, which is the point of the two halves. Reverse; `grep -c "runs || settings ? 'session' : 'fleet'" src/app.tsx` → `1`.
2. The rung — in `app.tsx`, delete the two lines `          ) : settings ? (` and `            <SettingsScreen />` → RED: the same case, on the heading (the placeholder renders). (`tsc` would also flag the now-unused import; vitest strips types, so the red is the test's.) Reverse; `grep -c '<SettingsScreen />' src/app.tsx` → `1`.
3. The door's destination — in `FleetScreen.tsx`, change `onClick={() => navigate('/settings')}` to `onClick={() => navigate('/accounts')}` → RED: `fleet-screen.test.tsx` › `sits in the fleet header, says what it is, and routes to /settings` (`expected '/accounts' to be '/settings'`). Reverse; `grep -c "navigate('/settings')" src/screens/FleetScreen.tsx` → `1`.
4. The tap floor — in `fleet.css`'s `.settings-door` rule, delete `min-height: var(--tap-min); ` → RED: `settings-screen.test.tsx` › `.settings-door is at least one tap tall …` (`expected null to be 'var(--tap-min)'`). Reverse; `grep -c 'min-height: var(--tap-min); padding: 0 var(--sp-1);' src/fleet/fleet.css` → `2` (`.accounts-door`'s line and this one — the count before the mutation, measured in Step 9's tree).
5. The wrap — in `fleet.css`, change `.fleet-head > .fleet-head-right { flex-wrap: wrap; justify-content` to `.fleet-head > .fleet-head-right { justify-content` → RED: `settings-screen.test.tsx` › `wraps the fleet head's right group …` (`expected null to be 'wrap'`). Reverse; `grep -c '.fleet-head > .fleet-head-right { flex-wrap: wrap;' src/fleet/fleet.css` → `1`.
6. The registration — in `audit.mjs`, delete the five-line `'fleet.css .settings-door': { … },` entry → RED: `contrast.test.ts` › `fleet.css .settings-door is registered on the page …` AND the pre-existing `contains no identities beyond the grandfathered blind spots` (`additions` is `['fleet.css .settings-door']`) — the census case is the control that shows the frozen set, not this task's own pin, is what refuses an unregistered rule; `node design/contrast-check.mjs --uncovered | grep -c '^#   '` prints `256`. Reverse; `grep -c "'fleet.css .settings-door': {" design/audit.mjs` → `1`, and the census prints `255` again.

After the last reversal, Step 9's first command is green again at the same four counts and `git status --short` lists exactly the nine files this task touches — seven ` M` (`app.tsx`, `FleetScreen.tsx`, `fleet.css`, `audit.mjs`, `app.test.tsx`, `fleet-screen.test.tsx`, `contrast.test.ts`) and two `??` (`SettingsScreen.tsx`, `settings-screen.test.tsx`; `git diff --stat` would not list the two new files).

- [ ] **Step 11: Commit**

```bash
git add pwa/src/screens/SettingsScreen.tsx pwa/src/app.tsx pwa/src/screens/FleetScreen.tsx pwa/src/fleet/fleet.css pwa/design/audit.mjs pwa/test/app.test.tsx pwa/test/fleet-screen.test.tsx pwa/test/settings-screen.test.tsx pwa/test/contrast.test.ts
cd server && ./node_modules/.bin/vitest run test/topology-clean.test.ts && cd ..
git commit -m "$(cat <<'EOF'
feat(update): the /settings route, its shell and its door in the fleet header

W3 Task 6 (design 2026-09-20 §13). app.tsx gains the fifth secondary route
at all three sites — the regex boolean, the data-view chain (a route left out
of it is hidden behind the fleet sidebar on a phone) and the .shell-detail
rung — pinned by app.test.tsx's heading + data-view case. SettingsScreen is
the AccountsScreen shell; Tasks 7-10 fill it.

The door sits in .fleet-head-right beside the Account door, glyph plus the
word, for D-161's discoverability argument. The group's measured width budget
(~38px left at 390px) cannot hold a fifth item, so the group now wraps by an
out-specifying override instead of overflowing (D-3303;
the door's own width is estimated from the tokens, not measured in a browser).
The five new colour rules are registered in INHERITED_GROUNDS rather than
entering the frozen census (D-2689); the door's desktop-sidebar ground is
measured in contrast.test.ts beside its page registration
(D-3304). contrast-check: ALL 572 PASS,
255 uncovered.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

`topology-clean` walks `git ls-files`, so it runs AFTER `git add` (the two new files are tracked from that moment) and BEFORE the commit; a red there means a residue token in a new file — fix it and re-add, never commit past it.

### Task 7: SettingsScreen — Updates: channel, auto, check now, catalogue line

**Files:**
- Modify: `pwa/src/screens/SettingsScreen.tsx` — the Updates section (`section.settings-section[aria-labelledby]` > `h2.settings-section-title` `Updates`): the channel fieldset, the auto fieldset and its gate note, the *Check now* button, the catalogue line; the screen's one `useUpdatesView()` and one `useNow(30_000)` inside `SettingsScreen`; a `not-configured` rendering, a first-read-failed rendering and a first-load `<Skeleton lines={3}/>` (the `AccountsScreen.tsx:293-317` three-state discipline). *(correction: the skeleton named the section's contents but not its shape. Two module-private components carry it — `UpdatesSection` (the frame and the three states before a view exists) and `UpdatesBody` (a non-null `view`, so Tasks 8 and 9 insert into a body where `view`, `now` and `reload` are props, not narrowed locals) — both placed AFTER `export function SettingsScreen`, at the end of the file. The exported helpers and the private sentences are placed BEFORE `export function SettingsScreen`, ending with `catalogueReasonText`, which is the anchor Task 8's insert names.)*
- Modify: `shared/api.ts` — `export const UPDATE_GATE_CAP = 'update-gate';` (with its docstring) APPENDED after the file's last line, which after W2 is W2 Task 4's `isUpdateStoreRefuseCode` closing `}` (Task 1 of this wave edits `UPDATE_STORE_REFUSE_CODES` in place and adds no line after it) — below every line `README.md:2560` and the session-hook citation audit cite (D-3188) (D-3305)
- Modify: `server/src/update/resolve.ts` — W2 Task 12's `export const UPDATE_GATE_CAP = 'update-gate';` and its one-line docstring replaced by a three-line docstring and `export { UPDATE_GATE_CAP };`; `UPDATE_GATE_CAP` added to the existing `'../../../shared/api.js'` import line (every W2 importer keeps `from './resolve.js'`; `update-resolve.test.ts`'s ring pin still reads exactly two specifiers — measured, below)
- Modify: `server/test/single-definition.test.ts` — one describe APPENDED after the file's last line: `UPDATE_GATE_CAP` is declared once and `'update-gate'` is quoted once across the four TS roots, both in `shared/api.ts`. An append moves no line the citation audit cites (`:32-37`, `:1274`, `:1303`, census 8 — R13)
- Modify: `pwa/src/fleet/fleet.css` — appended after the last line: `.settings-section`, `.settings-section-title`, `.settings-fieldset`, `.settings-legend`, `.settings-option` (`min-height: var(--tap-min)`), `.settings-option input`, `.settings-fieldset:disabled .settings-option`, `.settings-option-sentence`, `.settings-note`, `.settings-section .settings-check`, `.settings-catalogue`, `.settings-catalogue--amber`, `.settings-catalogue--muted` *(correction: the skeleton listed seven classes; the section also needs a title, a legend, the input and disabled-cursor rules, a MUTED variant for `never checked` (a third tone, not the calm one), and `.settings-check` is a layout-only override of the reused `.btn-ghost` primitive, scoped `.settings-section .settings-check` so it beats `.btn-ghost`'s `width: 100%` by specificity rather than by stylesheet load order — Task 8's `.settings-release .settings-move` shape)*
- Modify: `pwa/design/audit.mjs` — FOUR `INHERITED_GROUNDS` entries, `'fleet.css .settings-note'`, `'fleet.css .settings-catalogue'`, `'fleet.css .settings-catalogue--amber'`, `'fleet.css .settings-catalogue--muted'`, each `under: ['var(--bg-page)']`, inserted directly before `INHERITED_GROUNDS`' closing `};` (after `'fleet.css .build-line-side--warn'`'s entry at `d759c914`, and after any entry Task 6 appended) *(correction: the skeleton registered two. Every new rule that sets `color` and paints no ground must be registered, or `contrast.test.ts`'s "contains no identities beyond the grandfathered blind spots" reds on it — `.settings-catalogue` and `.settings-catalogue--muted` set colour too. The other new rules set no `color`: they inherit body's `--ink-primary` (`styles/base.css:111-112`), which the audit already measures on `--bg-page`)*
- Test: `pwa/test/settings-screen.test.tsx` — two describes APPENDED after the file's last line (`'SettingsScreen — Updates: helpers (W3 Task 7)'`, `'SettingsScreen — Updates: rendering (design 2026-09-20 §13)'`); names merged into the import lines Task 6 wrote, and FOUR new import lines, one per module Task 6's file does not import yet — the `import type` and the value import from `'../../shared/api'`, `'../src/lib/api'`, and `'../src/components/Toast'` (`ToastHost`) *(correction: this line said "ONE new import line (`ToastHost`)"; Task 6's file imports none of those four)*
- Run, not modified: W2's `server/test/update-resolve.test.ts` and `server/test/update-routes.test.ts` (both import `UPDATE_GATE_CAP` from `resolve.js`), `server/test/session-hook.test.ts` (R13: `shared/api.ts` and `single-definition.test.ts` are cited), `pwa/test/app.test.tsx` (Task 6's `/settings` pin now renders a polling screen), `pwa/test/fleet-css.test.ts`, `pwa/test/contrast.test.ts`, `node design/contrast-check.mjs`, `pwa` `npm run build`, `server` `tsc --noEmit`. `topology-clean.test.ts` is not owed: this task adds no file.

**Interfaces:**
- Consumes: Task 5's `useUpdatesView`, `UpdatesPoll` (`pwa/src/fleet/useUpdatesView.ts`), `api.setUpdateIntent` (resolves `IntentWriteAnswer | 'unreadable'`), `api.refreshUpdates` (resolves `CatalogueState`, rejects `ApiError` 429 `rate-limited`), `updateErrorText`, `ApiError` (`pwa/src/lib/api.ts`); W2 Task 1's `UPDATE_CHANNELS`, `AUTO_MODES`, `FLEET_SCOPE`, `UpdateChannel`, `AutoMode`, `CatalogueState`, `CatalogueErrorReason`, `NodeWire`, `UpdateIntentWire`, `UpdatesView`, `UpdateRouteError`, `UpdateRouteRefusal` (`shared/api.ts`); W2 Task 12's `UPDATE_GATE_CAP` and `autoGateBlockers` (`server/src/update/resolve.ts` — the 409's `nodes` are node IDS, reachable or not, a label-keyed placeholder's id being its label); W2 Task 13's intent route (`409 {ok:false, error:'auto-needs-rollback-gate', nodes}` when `auto ≠ off` and a node in scope lacks the word); `elapsedWords` (`pwa/src/lib/elapsed.ts:28` — a negative span clamps to `moments`); `useNow` (`pwa/src/lib/useNow.ts:8`); `toast` (`pwa/src/components/Toast.tsx:33` — an `'error'` toast renders `.toast.toast--error`, `:75`); `Skeleton` (`pwa/src/components/Skeleton.tsx:7`, `role="status" aria-label="Loading"`); `.btn-ghost` (`pwa/src/components/primitives.css:258-280`, the tap floor and the WCAG-exempt `:disabled` ink registered at `audit.mjs:513`); `declValue`, `ruleIn` (`pwa/test/cssRule.ts:98`, `:139`); Task 6's shell (`SettingsScreen`, `.settings-screen`, `header.settings-head`) and test file.
- Produces (exported from `SettingsScreen.tsx` for its tests; the screen is their one consumer):

```ts
/** Spec §13's two sentences, verbatim. */
export const CHANNEL_SENTENCES: Record<UpdateChannel, string> = {
  stable: "Stable — releases promoted after they've baked",
  dev: 'Dev — every merge, minutes after it lands',
};
export const AUTO_LABELS: Record<AutoMode, string> = {
  off: 'Off', stable: 'Stable releases only', channel: 'Every release on my channel',
};
/** Nodes whose caps lack UPDATE_GATE_CAP — the disabled state's list (D-3297). A caps field
 *  that is not an array counts as lacking it (a string would answer `.includes` by substring). */
export function autoGateMissing(nodes: readonly NodeWire[]): NodeWire[];
/** "14:02" — local clock time, zero-padded 24-hour; '—' for a time Date cannot place. */
export function clockTime(ms: number): string;
/** clockTime(ms) when ms falls on the same LOCAL calendar day as now, else "14:02 · 22 Sep" — the dated shape
 *  lib/clock.ts's resetClock and HistoryTab already print; '—' for a time Date cannot place. */
export function dayClock(ms: number, now: number): string;
export interface CatalogueLine { text: string; tone: 'calm' | 'amber' | 'muted' }
/** (D-3306) lastError !== null → amber: `couldn't reach GitHub since ${dayClock(lastOkAt, now)} — ${reason}`
 *  when lastOkAt is set, `couldn't reach GitHub (tried ${dayClock(lastError.at, now)}) — ${reason}` when it is null;
 *  else lastOkAt !== null → calm `checked ${elapsedWords(now - lastOkAt)} ago`; else muted `never checked`.
 *  NEVER "up to date" and never a "checked" line while lastOkAt is null. */
export function catalogueLine(c: CatalogueState, now: number): CatalogueLine;
/** CatalogueErrorReason → words: no-egress 'no network route to GitHub', rate-limited 'rate limited',
 *  malformed 'an answer this build could not read', no-release-source 'no release source configured',
 *  http-NNN (three digits) 'HTTP NNN'; any other string — a prototype name included — is shown as it came. */
export function catalogueReasonText(reason: string): string;
```

- Produces (in `shared/api.ts`, D-3305): `export const UPDATE_GATE_CAP = 'update-gate';` — and `server/src/update/resolve.ts` holds `export { UPDATE_GATE_CAP };` in place of its declaration.
- Produces for Tasks 8–10 (module-private, named so their inserts can anchor on them): `SettingsScreen` holds `const poll = useUpdatesView();` and `const now = useNow(30_000);` and renders `<UpdatesSection poll={poll} now={now} />` directly after Task 6's `</header>` (Task 10's Notifications section and unarmed banner read the same `poll`). In `SettingsScreen` the Updates section's `</section>` is NOT in sight — it closes inside `UpdatesSection` — and `SettingsScreen` binds no `view` or `reload`: a sibling section goes directly after the `<UpdatesSection poll={poll} now={now} />` line and reads `poll.view` / `poll.reload` (Task 10's `<NotificationsSection view={poll.view} reload={poll.reload} />`); `UpdatesBody({ view, stale, now, reload })` renders, in order, the stale note, the channel fieldset, the auto fieldset, the gate note, *Check now*, the refresh note, and — LAST — the catalogue line `<p className="settings-catalogue…">`, after which Task 8 inserts its release list.
- *(corrections, each a tightening: `clockTime` gains the `'—'` arm — `new Date(NaN).getHours()` is `NaN` and would print `NaN:NaN`; `catalogueReasonText` matches `http-` followed by exactly three digits and looks up OWN keys only (`Object.hasOwn`), so `'toString'` is shown as it came; a `409 auto-needs-rollback-gate` naming no string id falls back to the route's toast sentence rather than an empty "not yet on:" note; a first poll that failed with anything but `not-configured` renders its own sentence instead of a skeleton that would spin forever, and a failed poll after a good one renders a stale note ABOVE the last good answer (Review Focus 4). And one departure in wording that D-3306 covers too: spec §13 writes the calm line `checked 4 min ago`; this task renders it through `elapsedWords`, the PWA's one span formatter (`FleetHostBanner`'s `since …` reads the same), so it reads `checked 4m ago` — never a second hand-rolled duration format. D-3306 also covers a third wording change: the amber line's clock is `dayClock`, not a bare HH:MM, because `lastOkAt` freezes at the last success while W2 lets `lastError` recur without bound, so after an outage that crosses local midnight or lasts over a day `since 14:02` would read as TODAY's 14:02 and shrink the outage — the one line whose job is to make an outage look worse than the calm one; off the viewer's day it reads `since 14:02 · 22 Sep`.)*
- *(correction, from review: the 429 note no longer says "checked". W2's refresh route answers `429 rate-limited` inside a minute of the poller's `lastRequestAt()` (D-3203), which a FAILED request and the scheduled 30-minute poll both set — so a tap soon after a failed scheduled poll gets the 429 with `lastOkAt` still null, and the coordinator decisions' literal `checked less than a minute ago` would sit above the amber `couldn't reach GitHub (tried …)` line, a "checked" line while `lastOkAt` is null, which the Global Constraint "unreachable is not current" forbids at the settings surface. Task 5's `UPDATE_ERROR_TEXT['rate-limited']` now reads `GitHub was asked less than a minute ago — try again in a minute.`, claiming only that a request went out; a case below pins it over an unreached catalogue.)*
- Rendering rules: the auto note reads `Auto-install needs the rollback gate on every node — not yet on: ${labels.join(', ')}` (labels in `nodes()` order); the auto fieldset is `disabled` iff a write is in flight OR `autoGateMissing(view.nodes).length > 0`, and names the note in `aria-describedby`; a `409 auto-needs-rollback-gate` answer renders its `nodes` ids mapped to labels (an id no row carries is shown as the id) in the same note, and does not toast. The channel and auto rows are native `<fieldset>` + `<legend>` + `<label><input type="radio" name="settings-channel" | "settings-auto"></label>` rows (D-3299) whose `checked` reads `view.intent.find((i) => i.scope === FLEET_SCOPE)` — no radio is checked when that row is absent, and a tap never checks one: a change calls `api.setUpdateIntent({ scope: FLEET_SCOPE, channel | auto })`, then `reload()`, and the next poll moves the radio; `'unreadable'` toasts `Saved — the server's answer could not be read; the screen will re-check.`; any other rejection toasts `updateErrorText(err)` as an error. *Check now* calls `api.refreshUpdates()` then `reload()`; a 429 renders `updateErrorText(err)` — `GitHub was asked less than a minute ago — try again in a minute.` for the route's `rate-limited`, which claims a request, never a landed answer — as a note, and any other rejection toasts; no text in the section says "checked" while `lastOkAt` is null, the refresh note included. `failure === 'not-configured'` with no `view` renders `This box has no update control plane — it runs without a coordination database.` (Task 5's `UPDATE_ERROR_TEXT` read through `updateErrorText`, never a second copy) and nothing else of the section.
- Spec §18 rows pinned: "unreachable is not current" (the settings surface — mutation: render `checked` when `lastOkAt` is null → red; the amber-before-calm order — mutation: consult `lastOkAt` before `lastError` → red; the 429 note — mutation: `rate-limited`'s sentence back to `checked less than a minute ago` → red; and the amber clock's day — mutation: `dayClock` always same-day → red). The "vocabularies are declared once" discipline, extended to the gate word (mutation: a quoted `'update-gate'` in `pwa/src`, or a re-declaration in `resolve.ts` → red).

- [ ] **Step 1: Record the contrast audit's census before any edit**

Run: `cd pwa && node design/contrast-check.mjs | grep -E '^ALL [0-9]+ PASS$|rules set a colour with no ground'`
Expected: an `ALL <p> PASS` line and a `# <u> rules set a colour with no ground this auditor can recover …` line. Write both numbers down: after Step 9, `<u>` is unchanged and `<p>` has risen by exactly 8 (four registered rules, two themes each). Measured on a copy of `pwa/` at `d759c914` with no W3 CSS: `ALL 562 PASS` and `255`; after Task 6 they read whatever Task 6 left, which is why this step measures rather than quotes.

- [ ] **Step 2: Write the failing L0 case for the gate word**

Append to `server/test/single-definition.test.ts`, after the file's last line (nothing above it moves — R13):

```ts

// Design 2026-09-20 §9/§13 (programme wave 3, Task 7; D-3305):
// the ccrc-caps word the auto-install gate reads is spelled ONCE. W2 declared it
// in the server's L1 resolver, which the PWA cannot import — and the settings
// screen now disables its auto-install control on the same word
// (D-3297), so a second literal in pwa/src would be two
// spellings of one gate that nothing forces to agree. The declaration moved to
// L0 and `server/src/update/resolve.ts` re-exports it, so every W2 importer
// keeps its path. KNOWN WIDTH: the literal scan reads single- and double-quoted
// strings; a backticked mention is prose (`routes.ts`'s docstring names the word
// that way) and a template-literal copy in code would pass it. APPENDED after the
// file's last line: `session-hook.test.ts`'s citation audit cites this file by
// line, so nothing above may move (R13).
describe('the auto-install gate word is declared once, in L0 (programme wave 3)', () => {
  const LITERAL = /(['"])update-gate\1/;
  const DEF = /^\s*(?:export\s+)?(?:const|let|var)\s+UPDATE_GATE_CAP\b/m;

  it('CONTROL: the patterns see a declaration and a quoted copy, and not a re-export or a prose mention', () => {
    expect(DEF.test("export const UPDATE_GATE_CAP = 'update-gate';")).toBe(true);
    expect(DEF.test('const UPDATE_GATE_CAP = GATE;'), 'an un-exported copy is still a copy').toBe(true);
    expect(DEF.test('export { UPDATE_GATE_CAP };'), 'a re-export declares nothing').toBe(false);
    expect(DEF.test("import { UPDATE_GATE_CAP } from '../../../shared/api.js';"), 'an import declares nothing').toBe(false);
    expect(LITERAL.test("caps.includes('update-gate')")).toBe(true);
    expect(LITERAL.test('caps.includes("update-gate")')).toBe(true);
    expect(LITERAL.test('lacks `update-gate` in its measured caps'), 'a backticked prose mention').toBe(false);
    expect(LITERAL.test("'update-gates'"), 'another word').toBe(false);
  });

  it('UPDATE_GATE_CAP is declared in shared/api.ts and nowhere else — resolve.ts re-exports it', () => {
    expect(ALL.filter((f) => DEF.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });

  it('the word is quoted in shared/api.ts and nowhere else across the four roots', () => {
    expect(ALL.filter((f) => LITERAL.test(readFileSync(f, 'utf8'))).map(rel)).toEqual(['shared/api.ts']);
  });
});
```

- [ ] **Step 3: Run it red**

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'gate word'`
Expected: FAIL — `2 failed | 1 passed`, the rest skipped: both holder cases on `expected [ 'server/src/update/resolve.ts' ] to deeply equal [ 'shared/api.ts' ]`; the CONTROL passes. (Measured on a scratch copy of the tree at `d759c914` with a stand-in `server/src/update/resolve.ts` carrying W2's declaration line: exactly this output, `Tests  2 failed | 1 passed | 160 skipped (163)`; on the real W2 tree the skipped count is larger by W2's own cases.)

- [ ] **Step 4: Move the word to L0**

Append to `shared/api.ts`, after the file's last line (W2 Task 4's `isUpdateStoreRefuseCode` closing `}`). The block starts with a blank line; no line above changes and no import is added:

```ts

/** The ccrc-caps word a node must list before `auto ≠ off` may reach it (design 2026-09-20 §9; written by the
 *  node's install spine, programme wave 4). Declared HERE, in L0, since programme wave 3
 *  (D-3305): the resolver's `autoGateBlockers` (the intent route's advisory 409) and the
 *  settings screen, which disables its auto-install control before a tap (D-3297), read
 *  one word. `server/src/update/resolve.ts` re-exports it, so W2's importers keep their path. */
export const UPDATE_GATE_CAP = 'update-gate';
```

In `server/src/update/resolve.ts`, replace the import line W2 Task 12 wrote:

```ts
import { FLEET_SCOPE, isReleaseTag, type AutoMode, type UpdateChannel } from '../../../shared/api.js';
```

with:

```ts
import { FLEET_SCOPE, UPDATE_GATE_CAP, isReleaseTag, type AutoMode, type UpdateChannel } from '../../../shared/api.js';
```

and replace the two lines

```ts
/** The ccrc-caps word a node needs before `auto ≠ off` may reach it (§9; written by W4's spine). */
export const UPDATE_GATE_CAP = 'update-gate';
```

with:

```ts
/** The ccrc-caps word a node needs before `auto ≠ off` may reach it (§9; written by W4's spine). Declared in
 *  shared/api.ts since W3 (D-3305), because the settings screen disables its auto-install
 *  control on the same word; re-exported here, so every importer of this module keeps its import path. */
export { UPDATE_GATE_CAP };
```

(Match both by their CONTENT on the merged tree — if W2's review reworded the import line, add `UPDATE_GATE_CAP` to it in alphabetical position among the value names and keep the rest.) `update-resolve.test.ts`'s ring pin reads specifiers with `/^\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'|^\s*import\s+'([^']+)'/gm`; `export { UPDATE_GATE_CAP };` carries no `from`, so the set stays `{'../../../shared/api.js', '../../../shared/semver.js'}` — measured with that regex over the edited header: `[ '../../../shared/api.js', '../../../shared/semver.js' ]`.

- [ ] **Step 5: Run the server side green**

Run, from `server/`, one at a time, foreground:
- `./node_modules/.bin/vitest run test/single-definition.test.ts` → PASS, every case (the whole file: the three new ones and every W2/W3 case before them). Measured on the scratch copy: `Tests  163 passed (163)` at `d759c914` + this describe.
- `./node_modules/.bin/vitest run test/update-resolve.test.ts test/update-routes.test.ts` → PASS, W2's counts unchanged (both still import `UPDATE_GATE_CAP` from `resolve.js`; the ring pin still sees two specifiers).
- `./node_modules/.bin/vitest run test/session-hook.test.ts -t 'every line citation is anchored'` → PASS, `13 passed` (R13: both edits to cited files are appends after their last line; measured on the scratch copy with both appends: `Tests  13 passed | 320 skipped (333)`). `session-hook` is a named load flake — re-run in isolation before reading a red.
- `./node_modules/.bin/tsc --noEmit -p .` → exit 0.

- [ ] **Step 6: Write the failing screen tests**

Merge these names into `pwa/test/settings-screen.test.tsx`'s import lines (Task 6 created the file) — each name into the line for its module, only where that line does not already import it (a duplicate is a TypeScript error under `npm run build`, an unused name is `noUnusedLocals`), and create a line only for a module not imported yet:
- `'vitest'` — `describe`, `expect`, `it`, `vi`
- `'@testing-library/react'` — `fireEvent`, `render`, `screen`, `waitFor`, `within`
- `import type { … } from '../../shared/api'` — `CatalogueState`, `NodeWire`, `UpdateIntentWire`, `UpdatesView`
- the value import from `'../../shared/api'` — `AUTO_MODES`, `FLEET_SCOPE`, `UPDATE_GATE_CAP`
- `'../src/screens/SettingsScreen'` — `AUTO_LABELS`, `CHANNEL_SENTENCES`, `SettingsScreen`, `autoGateMissing`, `catalogueLine`, `catalogueReasonText`, `clockTime`, `dayClock`
- `'../src/lib/api'` — `ApiError`, `api`
- `'node:fs'` — `readFileSync`; `'node:path'` — `path` (default import); `'./cssRule'` — `declValue`, `ruleIn`
- `'../src/components/Toast'` — `ToastHost`

Of these, four modules have no line in Task 6's file, so exactly FOUR lines are new: `import type { CatalogueState, NodeWire, UpdateIntentWire, UpdatesView } from '../../shared/api';`, `import { AUTO_MODES, FLEET_SCOPE, UPDATE_GATE_CAP } from '../../shared/api';`, `import { ApiError, api } from '../src/lib/api';` and `import { ToastHost } from '../src/components/Toast';`. Every other name joins a line Task 6 wrote (`'vitest'` already carries all four of its names; `'@testing-library/react'` gains `waitFor` and `within`; `'../src/screens/SettingsScreen'` gains the six helpers and `dayClock`; `'node:fs'`, `'node:path'` and `'./cssRule'` are already complete).

Then APPEND after the file's last line. The file's own full `afterEach` (Task 6: `cleanup(); vi.restoreAllMocks(); navigate('/'); act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));`) covers both describes.

```tsx

// ── Task 7: the Updates section (design 2026-09-20 §13, §18) ─────────────────
// Fixtures carry the t7 prefix and stay module-level only because both
// describes read them: Tasks 8–10 keep their own, so no case here couples to a
// shape another task's cases own.
const T7_FLEET_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const T7_SERVER_ID = '1f1e1d1c-1b1a-4918-9716-151413121110';
/** A full NodeWire (W2 Task 1), measured and settled, WITHOUT the gate word — every W2 node's caps. */
const t7Node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: T7_FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false, version: 'v0.0.9' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  measuredAt: 1_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const t7Server = (over: Partial<NodeWire> = {}): NodeWire =>
  t7Node({ nodeId: T7_SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });
const T7_GATED = ['verify', 'node-id', 'floor', UPDATE_GATE_CAP];
const t7Intent = (over: Partial<UpdateIntentWire> = {}): UpdateIntentWire => ({
  scope: FLEET_SCOPE, channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: 1_000, setBy: 'test',
  ...over,
});
/** Checked 4 min 5 s before the call — "checked 4m ago" for the length of any case. */
const t7View = (over: Partial<UpdatesView> = {}): UpdatesView => ({
  catalogue: { lastOkAt: Date.now() - (4 * 60_000 + 5_000), lastError: null },
  releases: [],
  nodes: [t7Node(), t7Server()],
  intent: [t7Intent()],
  ...over,
});
/** 14:02 on 23 Sep 2026, LOCAL time — the clock the amber line prints, whatever zone the suite runs in; the helper cases pass their own `now`. */
const T7_1402 = new Date(2026, 8, 23, 14, 2).getTime();
/** 14:02 on the day the suite RUNS, local time. The rendering cases read the real clock (`useNow`), and the
 *  amber line dates an instant off the viewer's day (`dayClock`), so their fixed stamps must fall on today to
 *  print a bare `14:02` — T7_1402 there would print `14:02 · 23 Sep` on every other day. */
const T7_TODAY_1402 = (() => { const d = new Date(); d.setHours(14, 2, 0, 0); return d.getTime(); })();
/** Task 5's `rate-limited` sentence: a request went out, not that it landed. */
const T7_ASKED = 'GitHub was asked less than a minute ago — try again in a minute.';
const T7_NOT_CONFIGURED = 'This box has no update control plane — it runs without a coordination database.';
const T7_UNREAD = 'The update plane could not be read — the screen tries again every minute.';
const T7_STALE = 'The latest read failed — this is the last answer that landed.';
const T7_GATE_NOTE = 'Auto-install needs the rollback gate on every node — not yet on: ';
/** Mount the screen (beside a toast host) over one answer; resolves once the Updates section has its controls. */
const t7Mount = async (view: UpdatesView): Promise<HTMLElement> => {
  vi.spyOn(api, 'updates').mockResolvedValue(view);
  render(<><ToastHost /><SettingsScreen /></>);
  const region = screen.getByRole('region', { name: 'Updates' });
  await within(region).findByRole('button', { name: 'Check now' });
  return region;
};

describe('SettingsScreen — Updates: helpers (W3 Task 7)', () => {
  it('clockTime is the local 24-hour clock, zero-padded; a time Date cannot place is the missing mark', () => {
    expect(clockTime(T7_1402)).toBe('14:02');
    expect(clockTime(new Date(2026, 8, 23, 9, 5).getTime())).toBe('09:05');
    expect(clockTime(new Date(2026, 8, 23, 0, 0).getTime())).toBe('00:00');
    expect(clockTime(Number.NaN)).toBe('—');
  });

  it('dayClock is the bare clock on the viewer\'s own day and a dated clock off it — midnight and a day-long outage included', () => {
    expect(dayClock(T7_1402, T7_1402 + 9 * 3_600_000), 'same day, later').toBe('14:02');
    expect(dayClock(T7_1402, T7_1402 + 26 * 3_600_000), 'the next day').toBe('14:02 · 23 Sep');
    expect(dayClock(new Date(2026, 8, 23, 23, 50).getTime(), new Date(2026, 8, 24, 0, 10).getTime()), 'twenty minutes, across midnight')
      .toBe('23:50 · 23 Sep');
    expect(dayClock(T7_1402, new Date(2027, 8, 23, 15, 0).getTime()), 'the same date a year on is not today').toBe('14:02 · 23 Sep');
    expect(dayClock(Number.NaN, T7_1402)).toBe('—');
  });

  it('catalogueReasonText names each CatalogueErrorReason, reads http-NNN, and shows any other word as it came', () => {
    expect(catalogueReasonText('no-egress')).toBe('no network route to GitHub');
    expect(catalogueReasonText('rate-limited')).toBe('rate limited');
    expect(catalogueReasonText('malformed')).toBe('an answer this build could not read');
    expect(catalogueReasonText('no-release-source')).toBe('no release source configured');
    expect(catalogueReasonText('http-502')).toBe('HTTP 502');
    expect(catalogueReasonText('http-304')).toBe('HTTP 304');
    expect(catalogueReasonText('http-5020'), 'not a status code').toBe('http-5020');
    expect(catalogueReasonText('teapot')).toBe('teapot');
    expect(catalogueReasonText('toString'), 'own keys only').toBe('toString');
  });

  it('catalogueLine — checked, the two amber forms, never checked (spec §13, D-3306)', () => {
    expect(catalogueLine({ lastOkAt: T7_1402, lastError: null }, T7_1402 + 4 * 60_000 + 5_000))
      .toEqual({ text: 'checked 4m ago', tone: 'calm' });
    // A lastOkAt in the viewer's future (clock skew) is "moments", never a minus.
    expect(catalogueLine({ lastOkAt: T7_1402, lastError: null }, T7_1402 - 60_000))
      .toEqual({ text: 'checked moments ago', tone: 'calm' });
    // Reached at 14:02, failing since: "since" names the last good answer, which is measured.
    expect(catalogueLine({ lastOkAt: T7_1402, lastError: { at: T7_1402 + 90 * 60_000, reason: 'rate-limited' } }, T7_1402 + 91 * 60_000))
      .toEqual({ text: "couldn't reach GitHub since 14:02 — rate limited", tone: 'amber' });
    // Failing for 26 h: the clock carries its day, or "since 14:02" reads as
    // today's and makes a day-long outage look like two hours.
    expect(catalogueLine({ lastOkAt: T7_1402, lastError: { at: T7_1402 + 25 * 3_600_000, reason: 'no-egress' } }, T7_1402 + 26 * 3_600_000))
      .toEqual({ text: "couldn't reach GitHub since 14:02 · 23 Sep — no network route to GitHub", tone: 'amber' });
    // Never reached: no "since" it cannot measure — W2 keeps only the latest failure.
    expect(catalogueLine({ lastOkAt: null, lastError: { at: T7_1402, reason: 'no-egress' } }, T7_1402 + 60_000))
      .toEqual({ text: "couldn't reach GitHub (tried 14:02) — no network route to GitHub", tone: 'amber' });
    expect(catalogueLine({ lastOkAt: null, lastError: null }, T7_1402)).toEqual({ text: 'never checked', tone: 'muted' });
  });

  it('catalogueLine never says "checked" or "up to date" while lastOkAt is null (spec §18 "unreachable is not current")', () => {
    const unreached: CatalogueState[] = [
      { lastOkAt: null, lastError: null },
      ...['no-egress', 'rate-limited', 'http-503', 'malformed', 'no-release-source']
        .map((reason) => ({ lastOkAt: null, lastError: { at: T7_1402, reason } })),
    ];
    expect(unreached, 'guards the guard').toHaveLength(6);
    for (const c of unreached) {
      const { text, tone } = catalogueLine(c, T7_1402 + 60_000);
      expect(text, JSON.stringify(c)).not.toMatch(/^checked\b/);
      expect(text, JSON.stringify(c)).not.toMatch(/up to date/i);
      expect(tone, JSON.stringify(c)).not.toBe('calm');
    }
  });

  it('autoGateMissing lists every node whose measured caps lack the gate word, in wire order — a placeholder included', () => {
    const gated = t7Node({ caps: T7_GATED });
    const ungated = t7Server();
    // markUnreachable's label-keyed placeholder: never measured, no caps. §9
    // is written about exactly this node, and autoGateBlockers counts it too.
    // Its shape is W2 Task 5's markUnreachable: measuredAt NULL, stampRead
    // 'unreadable', installState/provenance/os 'unknown', caps ''.
    const placeholder = t7Node({
      nodeId: 'fleet', measuredAt: null, reachable: false, unreachableSince: 1_000, caps: [], current: null,
      stampRead: 'unreadable', installState: 'unknown', provenance: 'unknown', os: 'unknown',
    });
    expect(autoGateMissing([gated, ungated, placeholder]).map((n) => n.nodeId)).toEqual([T7_SERVER_ID, 'fleet']);
    expect(autoGateMissing([gated, t7Server({ caps: T7_GATED })])).toEqual([]);
    expect(autoGateMissing([])).toEqual([]);
    // A caps STRING would answer `.includes` by substring and read as gated.
    const malformed = { ...gated, caps: UPDATE_GATE_CAP } as unknown as NodeWire;
    expect(autoGateMissing([malformed])).toEqual([malformed]);
  });
});

describe('SettingsScreen — Updates: rendering (design 2026-09-20 §13)', () => {
  it('shows a loading block, and no control, until the first poll lands', () => {
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
    render(<SettingsScreen />);
    const region = screen.getByRole('region', { name: 'Updates' });
    expect(within(region).getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(within(region).queryByRole('radio')).toBeNull();
    expect(within(region).queryByRole('button', { name: 'Check now' })).toBeNull();
  });

  it('renders "checked 4m ago" in the calm style', async () => {
    const region = await t7Mount(t7View());
    const line = within(region).getByText('checked 4m ago');
    expect(line).toHaveClass('settings-catalogue');
    expect(line).not.toHaveClass('settings-catalogue--amber');
    expect(line).not.toHaveClass('settings-catalogue--muted');
  });

  it('renders a catalogue that stopped answering in amber — never the calm line it answered with before', async () => {
    const region = await t7Mount(t7View({
      catalogue: { lastOkAt: T7_TODAY_1402, lastError: { at: T7_TODAY_1402 + 90 * 60_000, reason: 'rate-limited' } },
    }));
    expect(within(region).getByText("couldn't reach GitHub since 14:02 — rate limited")).toHaveClass('settings-catalogue', 'settings-catalogue--amber');
    expect(within(region).queryByText(/^checked\b/)).toBeNull();
  });

  it('renders a catalogue never reached in amber with the time it was tried, and no "checked" line (§18)', async () => {
    const region = await t7Mount(t7View({ catalogue: { lastOkAt: null, lastError: { at: T7_TODAY_1402, reason: 'no-egress' } } }));
    expect(within(region).getByText("couldn't reach GitHub (tried 14:02) — no network route to GitHub")).toHaveClass('settings-catalogue--amber');
    expect(within(region).queryByText(/^checked\b/)).toBeNull();
    expect(within(region).queryByText(/up to date/i)).toBeNull();
  });

  it('renders "never checked" in the muted style when nothing was ever reached — never a "checked" line (§18)', async () => {
    const region = await t7Mount(t7View({ catalogue: { lastOkAt: null, lastError: null } }));
    expect(within(region).getByText('never checked')).toHaveClass('settings-catalogue', 'settings-catalogue--muted');
    expect(within(region).queryByText(/^checked\b/)).toBeNull();
    expect(within(region).queryByText(/up to date/i)).toBeNull();
  });

  it('checks the channel and auto radios the FLEET row names, not the first intent row', async () => {
    const region = await t7Mount(t7View({
      intent: [t7Intent({ scope: T7_FLEET_ID, channel: 'dev', auto: 'channel' }), t7Intent({ channel: 'stable', auto: 'off' })],
    }));
    expect(within(region).getByRole('radio', { name: CHANNEL_SENTENCES.stable })).toBeChecked();
    expect(within(region).getByRole('radio', { name: CHANNEL_SENTENCES.dev })).not.toBeChecked();
    expect(within(region).getByRole('radio', { name: AUTO_LABELS.off })).toBeChecked();
    expect(within(region).getByRole('radio', { name: AUTO_LABELS.channel })).not.toBeChecked();
  });

  it('checks nothing when the fleet row is absent — never a default the server does not hold', async () => {
    const region = await t7Mount(t7View({ intent: [t7Intent({ scope: T7_FLEET_ID, channel: 'dev' })] }));
    for (const radio of within(region).getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(within(region).getAllByRole('radio')).toHaveLength(5);
  });

  it('a tap on the other channel sends {scope: "*", channel} once and re-polls — the radio moves only when the server says so', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(t7View());
    const set = vi.spyOn(api, 'setUpdateIntent').mockResolvedValue({ ok: true, intent: t7Intent({ channel: 'dev' }), epoch: 2 });
    render(<SettingsScreen />);
    const dev = await screen.findByRole('radio', { name: CHANNEL_SENTENCES.dev });
    fireEvent.click(dev);
    await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ scope: FLEET_SCOPE, channel: 'dev' });
    // The re-poll still answers stable (the stub never changes), so the screen
    // shows stable: the server's row, not the tap.
    expect(screen.getByRole('radio', { name: CHANNEL_SENTENCES.stable })).toBeChecked();
    expect(dev).not.toBeChecked();
    // `.finally` clears busy and re-polls in one callback; the call count can
    // be seen before React has committed the cleared busy, so wait for it.
    await waitFor(() => expect(screen.getByRole('group', { name: 'Channel' })).not.toBeDisabled());
  });

  it('a write whose answer is unreadable toasts that it is unconfirmed; a refusal toasts the update sentence as an error', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t7View());
    const set = vi.spyOn(api, 'setUpdateIntent')
      .mockResolvedValueOnce('unreadable')
      .mockRejectedValueOnce(new ApiError(503, { ok: false, error: 'journal-unwritable', detail: 'EACCES' }));
    render(<><ToastHost /><SettingsScreen /></>);
    fireEvent.click(await screen.findByRole('radio', { name: CHANNEL_SENTENCES.dev }));
    expect(await screen.findByText("Saved — the server's answer could not be read; the screen will re-check.")).toBeInTheDocument();
    expect(document.querySelector('.toast--error')).toBeNull();
    await waitFor(() => expect(screen.getByRole('group', { name: 'Channel' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('radio', { name: CHANNEL_SENTENCES.dev }));
    await waitFor(() => expect(document.querySelector('.toast--error'))
      .toHaveTextContent('The server cannot write its intent journal — nothing was changed.'));
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('disables auto-install and names every node without the gate word (D-3297)', async () => {
    const region = await t7Mount(t7View());   // neither node carries it — every W2 node
    const auto = within(region).getByRole('group', { name: 'Auto-install' });
    expect(auto).toBeDisabled();
    for (const m of AUTO_MODES) expect(within(auto).getByRole('radio', { name: AUTO_LABELS[m] })).toBeDisabled();
    expect(within(region).getByText(`${T7_GATE_NOTE}fleet, server`)).toHaveClass('settings-note');
    expect(auto).toHaveAccessibleDescription(`${T7_GATE_NOTE}fleet, server`);
    // Only the auto choice is gated: the channel and Check now stay live.
    expect(within(region).getByRole('group', { name: 'Channel' })).not.toBeDisabled();
    expect(within(region).getByRole('button', { name: 'Check now' })).not.toBeDisabled();
  });

  it('names only the nodes that lack the word', async () => {
    const region = await t7Mount(t7View({ nodes: [t7Node({ caps: T7_GATED }), t7Server()] }));
    expect(within(region).getByRole('group', { name: 'Auto-install' })).toBeDisabled();
    expect(within(region).getByText(`${T7_GATE_NOTE}server`)).toBeInTheDocument();
  });

  it('enables auto-install when every node carries the word, and a tap sends {scope: "*", auto}', async () => {
    const set = vi.spyOn(api, 'setUpdateIntent').mockResolvedValue({ ok: true, intent: t7Intent({ auto: 'stable' }), epoch: 3 });
    const region = await t7Mount(t7View({ nodes: [t7Node({ caps: T7_GATED }), t7Server({ caps: T7_GATED })] }));
    const auto = within(region).getByRole('group', { name: 'Auto-install' });
    expect(auto).not.toBeDisabled();
    expect(within(region).queryByText(/not yet on:/)).toBeNull();
    fireEvent.click(within(auto).getByRole('radio', { name: AUTO_LABELS.stable }));
    await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
    expect(set).toHaveBeenCalledWith({ scope: FLEET_SCOPE, auto: 'stable' });
  });

  it('renders a 409 auto-needs-rollback-gate by node label — an id no row carries shown as the id — and not as a toast', async () => {
    vi.spyOn(api, 'setUpdateIntent').mockRejectedValue(
      new ApiError(409, { ok: false, error: 'auto-needs-rollback-gate', nodes: [T7_SERVER_ID, 'gone-node-id'] }));
    const region = await t7Mount(t7View({ nodes: [t7Node({ caps: T7_GATED }), t7Server({ caps: T7_GATED })] }));
    fireEvent.click(within(region).getByRole('radio', { name: AUTO_LABELS.channel }));
    expect(await within(region).findByText(`${T7_GATE_NOTE}server, gone-node-id`)).toHaveClass('settings-note');
    expect(document.querySelector('.toast--error')).toBeNull();
  });

  it('Check now refreshes once and re-polls; a 429 says GitHub was asked less than a minute ago', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(t7View());
    const refresh = vi.spyOn(api, 'refreshUpdates')
      .mockResolvedValueOnce({ lastOkAt: Date.now(), lastError: null })
      .mockRejectedValueOnce(new ApiError(429, { ok: false, error: 'rate-limited', retryAfterS: 42 }));
    render(<SettingsScreen />);
    const check = await screen.findByRole('button', { name: 'Check now' });
    fireEvent.click(check);
    await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith();
    expect(screen.queryByText(T7_ASKED)).toBeNull();
    await waitFor(() => expect(check).not.toBeDisabled());
    fireEvent.click(check);
    expect(await screen.findByText(T7_ASKED)).toHaveClass('settings-note');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a 429 over a catalogue never reached claims only a request — no "checked" text anywhere in the section (§18)', async () => {
    // W2 answers 429 inside a minute of lastRequestAt(), which a FAILED
    // scheduled poll sets too (D-3203): this is a tap just after one.
    vi.spyOn(api, 'refreshUpdates')
      .mockRejectedValue(new ApiError(429, { ok: false, error: 'rate-limited', retryAfterS: 42 }));
    const region = await t7Mount(t7View({ catalogue: { lastOkAt: null, lastError: { at: T7_TODAY_1402, reason: 'no-egress' } } }));
    fireEvent.click(within(region).getByRole('button', { name: 'Check now' }));
    expect(await within(region).findByText(T7_ASKED)).toHaveClass('settings-note');
    expect(within(region).getByText("couldn't reach GitHub (tried 14:02) — no network route to GitHub")).toHaveClass('settings-catalogue--amber');
    expect(within(region).queryByText(/^checked\b/)).toBeNull();
    expect(within(region).queryByText(/\bchecked\b/), 'nor a "checked" inside another sentence').toBeNull();
    expect(within(region).queryByText(/up to date/i)).toBeNull();
  });

  it('a box with no control plane says so, and nothing else of the section renders', async () => {
    vi.spyOn(api, 'updates').mockRejectedValue(new ApiError(501, { ok: false, error: 'not-configured' }));
    render(<SettingsScreen />);
    const region = screen.getByRole('region', { name: 'Updates' });
    expect(await within(region).findByText(T7_NOT_CONFIGURED)).toHaveClass('settings-note');
    expect(within(region).queryByRole('radio')).toBeNull();
    expect(within(region).queryByRole('button')).toBeNull();
    expect(within(region).queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('a first read that failed says so instead of loading forever', async () => {
    vi.spyOn(api, 'updates').mockRejectedValue(new TypeError('Failed to fetch'));
    render(<SettingsScreen />);
    const region = screen.getByRole('region', { name: 'Updates' });
    expect(await within(region).findByText(T7_UNREAD)).toBeInTheDocument();
    expect(within(region).queryByText(T7_NOT_CONFIGURED)).toBeNull();
    expect(within(region).queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('a later read that fails keeps the last answer on screen and says it is stale', async () => {
    vi.spyOn(api, 'updates').mockResolvedValueOnce(t7View()).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.spyOn(api, 'refreshUpdates').mockResolvedValue({ lastOkAt: Date.now(), lastError: null });
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }));   // its reload() is the failing read
    expect(await screen.findByText(T7_STALE)).toHaveClass('settings-note');
    expect(screen.getByRole('radio', { name: CHANNEL_SENTENCES.stable })).toBeChecked();
    expect(screen.getByText('checked 4m ago')).toBeInTheDocument();
  });

  it('floors every option row at the tap target, keeps a fieldset shrinkable, and tints the amber line with the attention ink', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
    expect(declValue(ruleIn(css, '.settings-option'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(css, '.settings-fieldset'), 'min-width')).toBe('0');
    expect(declValue(ruleIn(css, '.settings-catalogue--amber'), 'color')).toBe('var(--status-attention-text)');
  });
});
```

- [ ] **Step 7: Run the new describes to verify they fail**

`pwa/node_modules` is absent in a fresh workspace; install it first (`test -d pwa/node_modules || (cd pwa && npm ci)`).

Run: `cd pwa && ./node_modules/.bin/vitest run test/settings-screen.test.tsx -t 'Updates'`
Expected: FAIL — all 25 new cases red (6 helper + 19 rendering): the six helper cases on the missing exports, each a `TypeError` whose message ends `is not a function` (`clockTime`, `dayClock`, `catalogueReasonText`, `catalogueLine` twice, `autoGateMissing` — vitest's transform names the import binding, so match the ending, not the whole message); fourteen rendering cases on `Unable to find an accessible element with the role "region" and name "Updates"` (thrown by `getByRole` in the case or in `t7Mount`: loading, the four catalogue renderings, the two radio-state cases, the three auto-gate cases, the 409 case, the 429 over an unreached catalogue, not-configured and first-read-failed); two (the tap and the unreadable/refusal cases) on `TypeError: Cannot read properties of undefined (reading 'dev')`, where `CHANNEL_SENTENCES` is read first; two (*Check now* and the stale read, which render without `t7Mount`) timing out in `findByRole` on `Unable to find role="button" and name "Check now"`; and the CSS case on `no rule for .settings-option`. *(correction: the count said "seventeen rendering cases on the region" and omitted the two `Check now` timeouts)* Then `./node_modules/.bin/vitest run test/settings-screen.test.tsx` shows no failure outside the two new describes (Task 6's cases stay green). These counts are derived from the file, not measured — `pwa/node_modules` was absent where this plan was written.

- [ ] **Step 8: Implement the Updates section in `pwa/src/screens/SettingsScreen.tsx`**

Merge the imports into the lines Task 6 wrote (one line per module; add a line only where the module is not imported yet), so the file's import block holds, besides Task 6's `ReactNode` type import, `navigate` and `'../fleet/fleet.css'`:

```tsx
import { useId, useState } from 'react';
import type { AutoMode, CatalogueErrorReason, CatalogueState, NodeWire, UpdateChannel, UpdateRouteError, UpdateRouteRefusal, UpdatesView } from '../../../shared/api';
import { AUTO_MODES, FLEET_SCOPE, UPDATE_CHANNELS, UPDATE_GATE_CAP } from '../../../shared/api';
import { Skeleton } from '../components/Skeleton';
import { toast } from '../components/Toast';
import { useUpdatesView, type UpdatesPoll } from '../fleet/useUpdatesView';
import { ApiError, api, updateErrorText } from '../lib/api';
import { elapsedWords } from '../lib/elapsed';
import { useNow } from '../lib/useNow';
```

Insert between the import block and `export function SettingsScreen` (after any module-level text Task 6 placed there), so that `catalogueReasonText` is the last declaration before `SettingsScreen` — Task 8 inserts directly after it:

```tsx

// ── The Updates section (spec §13; programme wave 3 Task 7) ──────────────────
// Channel, auto-install, Check now and the catalogue line, over the screen's
// ONE /api/updates poll. Three rules this block keeps, each pinned in
// settings-screen.test.tsx:
//   * THE SERVER'S ROW IS WHAT IS SHOWN. A radio is checked from the fleet
//     intent row (`scope === FLEET_SCOPE`) the last poll returned, never from
//     the tap: a change writes a partial through api.setUpdateIntent and
//     re-polls, so a refused or lost write cannot leave a choice on screen
//     that the server does not hold.
//   * UNREACHABLE IS NOT CURRENT (§18). The line says "checked" only off a
//     non-null lastOkAt; a failed check is amber and says only what it can
//     measure (D-3306); nothing here says "up to date".
//   * THE AUTO GATE IS ADVISORY HERE. The auto-install fieldset is disabled
//     from the nodes' measured caps before a tap (D-3297);
//     the intent route's 409 stays the authority, and when it answers, its
//     node list is rendered by label in the same note.
// The selectors are native radios in a fieldset (D-3299):
// the platform supplies the group's role, its name (the legend), arrow-key
// movement and the checked state.

/** Spec §13's two channel sentences, verbatim — one radio row each. */
export const CHANNEL_SENTENCES: Record<UpdateChannel, string> = {
  stable: "Stable — releases promoted after they've baked",
  dev: 'Dev — every merge, minutes after it lands',
};

/** The auto-install choices (`AutoMode`, W2) in the operator's words. */
export const AUTO_LABELS: Record<AutoMode, string> = {
  off: 'Off',
  stable: 'Stable releases only',
  channel: 'Every release on my channel',
};

/** The auto-install note's lead; the node labels follow, in `nodes()` order. */
const AUTO_GATE_NOTE = 'Auto-install needs the rollback gate on every node — not yet on: ';
/** A write that answered 2xx but unreadably (`postJsonOr`'s `unreadable`, D-1150): it may have landed. */
const UNCONFIRMED_TEXT = "Saved — the server's answer could not be read; the screen will re-check.";
/** The first poll never landed and was not a 501 — a read that failed, said as one, not a skeleton forever. */
const UNREAD_TEXT = 'The update plane could not be read — the screen tries again every minute.';
/** A later poll failed: what is shown is the last answer that landed, and it says so. */
const STALE_TEXT = 'The latest read failed — this is the last answer that landed.';
/** The update surface's own sentence for a box with no control plane — Task 5's table, read through its one
 *  translator, so this file holds no second copy of it. */
const NOT_CONFIGURED_TEXT = updateErrorText(new ApiError(501, { ok: false, error: 'not-configured' }));
/** The one intent refusal rendered in place (by node label) instead of toasted (W2 Task 13). */
const AUTO_GATE_REFUSAL = 'auto-needs-rollback-gate' satisfies UpdateRouteError;

export function autoGateMissing(nodes: readonly NodeWire[]): NodeWire[] {
  // Array.isArray, not a bare `.includes`: a caps field that arrived as a
  // STRING would answer by substring and read as gated.
  return nodes.filter((n) => !(Array.isArray(n.caps) && n.caps.includes(UPDATE_GATE_CAP)));
}

/** The node ids a `409 auto-needs-rollback-gate` names; null for any other failure, and for a 409 naming no id
 *  (the caller then toasts the route's own sentence rather than an empty "not yet on:"). */
function gateRefusalOf(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  if (typeof err.body !== 'object' || err.body === null) return null;
  const { error, nodes } = err.body as Partial<UpdateRouteRefusal>;
  if (error !== AUTO_GATE_REFUSAL || !Array.isArray(nodes)) return null;
  const ids = nodes.filter((id) => typeof id === 'string');
  return ids.length > 0 ? ids : null;
}

export function clockTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The amber line's clock (D-3306): bare on the viewer's own local day, dated off it, because
 *  lastOkAt freezes at the last success while a failure may recur for days — "since 14:02" alone would read as
 *  today's 14:02 and shrink the outage. The dated shape is the one lib/clock.ts's resetClock and HistoryTab
 *  already print ("14:02 · 22 Sep"); resetClock itself is not reused because it reads epoch SECONDS and has no
 *  '—' arm for an instant Date cannot place. */
export function dayClock(ms: number, now: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const n = new Date(now);
  const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return sameDay ? clockTime(ms) : `${clockTime(ms)} · ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}

export interface CatalogueLine { text: string; tone: 'calm' | 'amber' | 'muted' }

export function catalogueLine(c: CatalogueState, now: number): CatalogueLine {
  // The failure arm FIRST: a catalogue that answered an hour ago and has failed
  // since is amber, never the calm "checked 1h ago" it would read as if
  // lastOkAt were consulted first (W2 clears lastError on the next success).
  if (c.lastError !== null) {
    const reason = catalogueReasonText(c.lastError.reason);
    return c.lastOkAt !== null
      ? { text: `couldn't reach GitHub since ${dayClock(c.lastOkAt, now)} — ${reason}`, tone: 'amber' }
      : { text: `couldn't reach GitHub (tried ${dayClock(c.lastError.at, now)}) — ${reason}`, tone: 'amber' };
  }
  if (c.lastOkAt !== null) return { text: `checked ${elapsedWords(now - c.lastOkAt)} ago`, tone: 'calm' };
  return { text: 'never checked', tone: 'muted' };
}

/** `CatalogueErrorReason` (W2) in words, keyed by the union less its `http-NNN` family, so a word W2 adds is a
 *  compile error here until it has one. */
const CATALOGUE_REASON_TEXT: Record<Exclude<CatalogueErrorReason, `http-${number}`>, string> = {
  'no-egress': 'no network route to GitHub',
  'rate-limited': 'rate limited',
  malformed: 'an answer this build could not read',
  'no-release-source': 'no release source configured',
};

export function catalogueReasonText(reason: string): string {
  if (Object.hasOwn(CATALOGUE_REASON_TEXT, reason)) {
    return CATALOGUE_REASON_TEXT[reason as keyof typeof CATALOGUE_REASON_TEXT];
  }
  const http = /^http-(\d{3})$/.exec(reason);
  return http !== null ? `HTTP ${http[1]}` : reason;
}
```

In `export function SettingsScreen(): ReactNode` (Task 6's shell), insert as the function body's first statements:

```tsx
  // ONE poll and ONE clock for the whole screen: every section reads the same
  // answer (Tasks 7–10), so two sections can never disagree about the fleet.
  const poll = useUpdatesView();
  const now = useNow(30_000);
```

and directly after the shell's closing `</header>`, the line:

```tsx
      <UpdatesSection poll={poll} now={now} />
```

Then append at the end of the file, after `SettingsScreen`'s closing brace:

```tsx

/** The Updates section's frame: its heading, and the three states before any view exists — loading, a box with
 *  no control plane, a first read that failed — each its own render (AccountsScreen's three-state discipline),
 *  so "don't know yet" never borrows the rendering of "nothing there". */
function UpdatesSection({ poll, now }: { poll: UpdatesPoll; now: number }): ReactNode {
  const titleId = useId();
  const { view, failure, reload } = poll;
  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-section-title">Updates</h2>
      {view !== null ? (
        <UpdatesBody view={view} stale={failure !== null} now={now} reload={reload} />
      ) : failure === 'not-configured' ? (
        <p className="settings-note">{NOT_CONFIGURED_TEXT}</p>
      ) : failure === 'failed' ? (
        <p className="settings-note">{UNREAD_TEXT}</p>
      ) : (
        <Skeleton lines={3} />
      )}
    </section>
  );
}

/** The section over a landed view. `view` is the LAST GOOD answer (useUpdatesView keeps it across a failed
 *  poll); `stale` says a later poll failed. Tasks 8 and 9 render the release list and the node inventory
 *  after the catalogue line, from these same props. */
function UpdatesBody({ view, stale, now, reload }: {
  view: UpdatesView; stale: boolean; now: number; reload: () => void;
}): ReactNode {
  const gateNoteId = useId();
  const [busy, setBusy] = useState(false);
  const [gateRefusal, setGateRefusal] = useState<string[] | null>(null);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);

  const fleet = view.intent.find((i) => i.scope === FLEET_SCOPE) ?? null;
  const missing = autoGateMissing(view.nodes);
  const labelOf = (id: string): string => view.nodes.find((n) => n.nodeId === id)?.label ?? id;
  // The route's answer, when it gave one, is the authority over the poll's.
  const gateLabels = gateRefusal !== null ? gateRefusal.map(labelOf) : missing.map((n) => n.label);
  const gateNote = gateLabels.length > 0 ? `${AUTO_GATE_NOTE}${gateLabels.join(', ')}` : null;
  const line = catalogueLine(view.catalogue, now);

  const writeIntent = (patch: { channel: UpdateChannel } | { auto: AutoMode }): void => {
    setBusy(true);
    if ('auto' in patch) setGateRefusal(null);
    void api.setUpdateIntent({ scope: FLEET_SCOPE, ...patch })
      .then(
        (answer) => { if (answer === 'unreadable') toast(UNCONFIRMED_TEXT); },
        (err: unknown) => {
          const refused = gateRefusalOf(err);
          if (refused !== null) setGateRefusal(refused);
          else toast(updateErrorText(err), 'error');
        },
      )
      .finally(() => { setBusy(false); reload(); });
  };

  const checkNow = (): void => {
    setBusy(true);
    setRefreshNote(null);
    void api.refreshUpdates()
      .catch((err: unknown) => {
        // A 429 is the route's minute guard (W2 Task 13), not a failure: GitHub
        // was ASKED less than a minute ago — by a request that may itself have
        // failed (D-3203 counts every request), so the note claims the request
        // and never a "checked" (the catalogue line owns that word, and only
        // off a non-null lastOkAt).
        if (err instanceof ApiError && err.status === 429) setRefreshNote(updateErrorText(err));
        else toast(updateErrorText(err), 'error');
      })
      .finally(() => { setBusy(false); reload(); });
  };

  return (
    <>
      {stale && <p className="settings-note">{STALE_TEXT}</p>}
      <fieldset className="settings-fieldset" disabled={busy}>
        <legend className="settings-legend">Channel</legend>
        {UPDATE_CHANNELS.map((c) => (
          <label key={c} className="settings-option">
            <input
              type="radio"
              name="settings-channel"
              value={c}
              checked={fleet !== null && fleet.channel === c}
              onChange={() => writeIntent({ channel: c })}
            />
            <span className="settings-option-sentence">{CHANNEL_SENTENCES[c]}</span>
          </label>
        ))}
      </fieldset>
      <fieldset
        className="settings-fieldset"
        disabled={busy || missing.length > 0}
        aria-describedby={gateNote !== null ? gateNoteId : undefined}
      >
        <legend className="settings-legend">Auto-install</legend>
        {AUTO_MODES.map((m) => (
          <label key={m} className="settings-option">
            <input
              type="radio"
              name="settings-auto"
              value={m}
              checked={fleet !== null && fleet.auto === m}
              onChange={() => writeIntent({ auto: m })}
            />
            <span className="settings-option-sentence">{AUTO_LABELS[m]}</span>
          </label>
        ))}
      </fieldset>
      {gateNote !== null && <p id={gateNoteId} className="settings-note">{gateNote}</p>}
      <button type="button" className="btn-ghost settings-check" disabled={busy} onClick={checkNow}>
        Check now
      </button>
      {refreshNote !== null && <p className="settings-note" aria-live="polite">{refreshNote}</p>}
      <p className={line.tone === 'calm' ? 'settings-catalogue' : `settings-catalogue settings-catalogue--${line.tone}`}>
        {line.text}
      </p>
    </>
  );
}
```

No comment or string in this file quotes the gate word itself — `UPDATE_GATE_CAP` is its only spelling (Step 2's scan walks `pwa/src`).

- [ ] **Step 9: Append the CSS and register the four inherited grounds**

Append to `pwa/src/fleet/fleet.css`, after its last line:

```css

/* — centralised update management W3, Task 7: SettingsScreen's Updates section —
   The section is a hairline-topped block on the screen's own ground, not a
   card: .settings-screen and .settings-section paint no background, and
   neither does .shell-detail, so body's --bg-page is what sits behind every
   line here. Each rule below that sets `color` is therefore registered in
   design/audit.mjs's INHERITED_GROUNDS against --bg-page; the rules that set
   none inherit body's --ink-primary, which the page ground already measures.
   The three selectors are native radios (D-3299):
   a <label> row is the whole tap target, floored at --tap-min. */
.settings-section {
  display: grid;
  gap: var(--sp-2);
  min-width: 0;
  padding-top: var(--sp-3);
  border-top: 1px solid var(--edge-subtle);
}
.settings-section-title { font: var(--weight-semibold) var(--text-sm) / var(--leading-tight) var(--font-ui); }
/* A fieldset's UA default is `min-inline-size: min-content`, which lets one
   long sentence push the page sideways on a phone; zero it like every grid
   child in this file. */
.settings-fieldset { display: grid; min-width: 0; margin: 0; padding: 0; border: 0; }
.settings-legend {
  padding: 0;
  margin-bottom: var(--sp-1);
  font: var(--weight-medium) var(--text-xs) / var(--leading-tight) var(--font-mono);
}
.settings-option {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  min-height: var(--tap-min);
  cursor: pointer;
}
.settings-option input { flex: none; width: 18px; height: 18px; margin: 0; }
.settings-fieldset:disabled .settings-option { cursor: default; }
.settings-option-sentence { min-width: 0; font-size: var(--text-sm); line-height: var(--leading-normal); }
.settings-note { font-size: var(--text-xs); line-height: var(--leading-normal); color: var(--ink-secondary); }
/* `.btn-ghost` (primitives.css) supplies the tap floor, the border and the
   disabled ink; this only stops it filling the section's width. */
.settings-section .settings-check { width: auto; justify-self: start; padding: 0 var(--sp-3); }
/* The catalogue line: three renderings, and the amber one is never the calm
   one (spec §13). Calm is the secondary ink, "never checked" the tertiary,
   and an unreached catalogue borrows the attention amber BuildLine's warn
   side already uses. */
.settings-catalogue {
  font: var(--weight-regular) var(--text-xs) / var(--leading-normal) var(--font-mono);
  color: var(--ink-secondary);
}
.settings-catalogue--amber { color: var(--status-attention-text); }
.settings-catalogue--muted { color: var(--ink-tertiary); }
```

In `pwa/design/audit.mjs`, directly before `INHERITED_GROUNDS`' closing `};` (after the last entry — `'fleet.css .build-line-side--warn'` at `d759c914`, or whatever Task 6 appended after it):

```js
  // ── centralised update management W3, Task 7: the Updates section ───────
  'fleet.css .settings-note': {
    under: ['var(--bg-page)'],
    why: "SettingsScreen's explanatory lines (the auto-install gate note, the Check now answer, the not-configured and stale-read sentences). .settings-section and .settings-screen paint no background, and neither does .shell-detail, so body's --bg-page (styles/base.css:111) is behind them — the .pool-epoch-lag reasoning. Its selector names no painted ancestor",
  },
  'fleet.css .settings-catalogue': {
    under: ['var(--bg-page)'],
    why: "the catalogue line's calm rendering ('checked 4m ago') in the same unpainted Updates section on SettingsScreen. Same ground and same reason as .settings-note",
  },
  'fleet.css .settings-catalogue--amber': {
    under: ['var(--bg-page)'],
    why: "the catalogue line's amber rendering (couldn't reach GitHub …), retinted to --status-attention-text on the same unpainted section. Registered separately because it overrides `color` directly — the .build-line-side--warn reason",
  },
  'fleet.css .settings-catalogue--muted': {
    under: ['var(--bg-page)'],
    why: "the catalogue line's 'never checked' rendering in --ink-tertiary, on the same unpainted section as .settings-catalogue. Registered separately because it overrides `color` directly",
  },
```

Run: `cd pwa && node design/contrast-check.mjs | grep -E '^ALL [0-9]+ PASS$|rules set a colour with no ground|settings-'`
Expected: `ALL <p+8> PASS` (Step 1's `<p>` plus 8), the uncovered line still Step 1's `<u>`, and eight `PASS` rows for this task's rules. Measured on a copy of `pwa/` at `d759c914` with exactly this CSS and these four entries: `ALL 570 PASS` (562 before), `255` uncovered (unchanged), and `.settings-note` / `.settings-catalogue` 9.36 dark / 6.81 light, `.settings-catalogue--amber` 10.89 / 5.45, `.settings-catalogue--muted` 6.23 / 5.25. Then `node design/contrast-check.mjs --uncovered | grep -E '^#   fleet\.css \.settings'` prints nothing (measured: exit 1, no line).

- [ ] **Step 10: Run green**

Run, one at a time, foreground, from `pwa/`:
- `./node_modules/.bin/vitest run test/settings-screen.test.tsx` → PASS, every case (the 25 new ones and every Task 6 case)
- `./node_modules/.bin/vitest run test/app.test.tsx` → PASS (Task 6's `/settings` pin: the screen now polls; an unstubbed `api.updates()` rejects inside jsdom and the section renders the unread sentence, which the heading/`data-view` pin does not read)
- `./node_modules/.bin/vitest run test/fleet-css.test.ts test/contrast.test.ts` → PASS (the `repeat(n, 1fr)` sweep; "has no stale inherited registry entry", "contains no identities beyond the grandfathered blind spots" and the `why`-length case read the four new entries)
- `node design/contrast-check.mjs` → exit 0, `ALL <p+8> PASS`
- `npm run build` → `tsc --noEmit` clean (it compiles `../shared`, so `UPDATE_GATE_CAP`'s append is type-checked here too; a duplicated or unused import from Step 6/8's merge fails here, not in vitest), then the Vite build
- `./node_modules/.bin/vitest run` → PASS, the whole pwa suite (no suite list is enough — `single-definition` is not the only scan that walks `pwa/src`)

Then from `server/`: `./node_modules/.bin/vitest run test/single-definition.test.ts` → PASS again (it walks `pwa/src`, which now imports the word instead of spelling it).

- [ ] **Step 11: Mutation measurement**

Each edit is one hand edit (the Edit tool) to the named file, the named run red, then the edit reversed by hand — never `git checkout --`, which would discard this task's uncommitted work — and the restore confirmed by `grep -c` on the original text printing `1`. PWA runs are `cd pwa && ./node_modules/.bin/vitest run test/settings-screen.test.tsx -t 'Updates'`; server runs are `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'gate word'`.

1. Spec §18 "unreachable is not current" — the settings surface. In `catalogueLine`, delete the guard `if (c.lastOkAt !== null) ` from the start of the calm line and replace that line's `now - c.lastOkAt` with `now - (c.lastOkAt ?? 0)`, so the line reads ``return { text: `checked ${elapsedWords(now - (c.lastOkAt ?? 0))} ago`, tone: 'calm' };`` → RED: `catalogueLine never says "checked" …` (the `lastOkAt: null, lastError: null` row renders `checked …`), `catalogueLine — checked, the two amber forms, never checked`, and `renders "never checked" in the muted style …`. Reverse; `grep -c 'if (c.lastOkAt !== null) return' pwa/src/screens/SettingsScreen.tsx` → `1`.
2. The same row — the amber is never the calm one. Change `if (c.lastError !== null) {` to `if (c.lastError !== null && c.lastOkAt === null) {` → RED: `renders a catalogue that stopped answering in amber …` (it renders `checked …` in calm while failing) and the helper's `since 14:02` expectation. Reverse; `grep -c 'if (c.lastError !== null) {' pwa/src/screens/SettingsScreen.tsx` → `1`.
3. D-3297 — change `disabled={busy || missing.length > 0}` to `disabled={busy}` → RED: `disables auto-install and names every node without the gate word` (`toBeDisabled` fails on the group) and `names only the nodes that lack the word`. Reverse; `grep -c 'disabled={busy || missing.length > 0}' pwa/src/screens/SettingsScreen.tsx` → `1`.
4. The caps shape guard — in `autoGateMissing`, change `!(Array.isArray(n.caps) && n.caps.includes(UPDATE_GATE_CAP))` to `!n.caps.includes(UPDATE_GATE_CAP)` → RED: `autoGateMissing lists every node …` (the caps string answers `includes` by substring: `expected [] to deeply equal [ { … } ]`). Reverse; `grep -c 'Array.isArray(n.caps) && n.caps.includes(UPDATE_GATE_CAP)' pwa/src/screens/SettingsScreen.tsx` → `1`.
5. The route stays the authority — in `gateRefusalOf`, change `err.status !== 409` to `err.status !== 400` → RED: `renders a 409 auto-needs-rollback-gate by node label …` (no note; an error toast instead). Reverse; `grep -c 'err.status !== 409' pwa/src/screens/SettingsScreen.tsx` → `1`.
6. The fleet row, not the first row — change `view.intent.find((i) => i.scope === FLEET_SCOPE)` to `view.intent.find(() => true)` → RED: `checks the channel and auto radios the FLEET row names …` (`dev` is checked) and `checks nothing when the fleet row is absent …`. Reverse; `grep -c 'view.intent.find((i) => i.scope === FLEET_SCOPE)' pwa/src/screens/SettingsScreen.tsx` → `1`.
7. The write re-polls — in `writeIntent`'s `.finally`, change `{ setBusy(false); reload(); }` to `{ setBusy(false); }` (the FIRST of the two occurrences) → RED: `a tap on the other channel … re-polls` (`updates` stays at 1 call; `waitFor` times out). Reverse; `grep -c '.finally(() => { setBusy(false); reload(); });' pwa/src/screens/SettingsScreen.tsx` → `2`.
8. The 429 is a note — change `err.status === 429` to `err.status === 430` → RED: `Check now refreshes once and re-polls; a 429 says …` and `a 429 over a catalogue never reached …` (`findByText` times out; the sentence went to a toast no host renders). Reverse; `grep -c 'err.status === 429' pwa/src/screens/SettingsScreen.tsx` → `1`.
9. Not-configured is its own state (Review Focus 4) — in `UpdatesSection`, change `) : failure === 'not-configured' ? (` to `) : failure === 'unmeasured' as string ? (` → RED: `a box with no control plane says so …` (the skeleton renders instead). Reverse; `grep -c ") : failure === 'not-configured' ? (" pwa/src/screens/SettingsScreen.tsx` → `1`.
10. The gate word is L0's (D-3305) — in `autoGateMissing`, change `n.caps.includes(UPDATE_GATE_CAP)` to `n.caps.includes('update-gate')` → the PWA describes stay GREEN (the behaviour is identical — which is why the scan exists), and the server run is RED: `the word is quoted in shared/api.ts and nowhere else …` receives `[ 'pwa/src/screens/SettingsScreen.tsx', 'shared/api.ts' ]` (measured with the same literal planted in a scratch `pwa/src` file: `+   "pwa/src/screens/PlantedGate.tsx"`, `1 failed | 2 passed`). Reverse; `grep -c 'n.caps.includes(UPDATE_GATE_CAP)' pwa/src/screens/SettingsScreen.tsx` → `1`.
11. The same — `resolve.ts` re-declares instead of re-exporting. Replace `export { UPDATE_GATE_CAP };` with `export const UPDATE_GATE_CAP = 'update-gate';` and remove `UPDATE_GATE_CAP, ` from its `'../../../shared/api.js'` import → RED: both holder cases, receiving `[ 'server/src/update/resolve.ts', 'shared/api.ts' ]`. Reverse both edits; `grep -c '^export { UPDATE_GATE_CAP };$' server/src/update/resolve.ts` → `1`.
12. D-3306 — the amber clock carries its day. In `dayClock`, change `return sameDay ? clockTime(ms)` to `return true ? clockTime(ms)` → RED: `dayClock is the bare clock on the viewer's own day …` (`expected '14:02' to be '14:02 · 23 Sep'`) and `catalogueLine — checked, the two amber forms, never checked` (the 26 h case reads `since 14:02 — …`). Reverse; `grep -c 'return sameDay ? clockTime(ms)' pwa/src/screens/SettingsScreen.tsx` → `1`.
13. Spec §18 "unreachable is not current" — the refresh note. In `pwa/src/lib/api.ts` (Task 5's file), change `UPDATE_ERROR_TEXT`'s `'rate-limited': 'GitHub was asked less than a minute ago — try again in a minute.',` to `'rate-limited': 'checked less than a minute ago',` → RED: `a 429 over a catalogue never reached claims only a request …` and `Check now refreshes once and re-polls; a 429 says …` (both `findByText(T7_ASKED)` time out: the note renders the old sentence, which is also the "checked" line over a null `lastOkAt` the new case forbids). Reverse; `grep -c "'rate-limited': 'GitHub was asked less than a minute ago — try again in a minute.'," pwa/src/lib/api.ts` → `1`. (This mutation's edit is to a file outside this task's seven; the reversal restores it byte-for-byte, and Task 5's `api.test.ts` pins the same sentence from its side.)

After the last reversal, Step 10's `settings-screen.test.tsx` run and Step 5's `single-definition.test.ts` run are green again, and `git diff --stat` lists exactly the seven files of Step 12.

- [ ] **Step 12: Commit**

```bash
git add shared/api.ts server/src/update/resolve.ts server/test/single-definition.test.ts pwa/src/screens/SettingsScreen.tsx pwa/src/fleet/fleet.css pwa/design/audit.mjs pwa/test/settings-screen.test.tsx
git commit -m "feat(update): the Updates section on /settings — channel and auto-install as native radios over the fleet row, auto disabled from the nodes' gate word (moved to L0), Check now with its 429 note, and a catalogue line that never says checked while GitHub was never reached"
```

### Task 8: SettingsScreen — the release list

**Files:**
- Modify: `pwa/src/screens/SettingsScreen.tsx` — five exported helpers (`sortReleases`, `verifiedAt`, `releaseDirection`, `refusedLine`, `releaseDate`) and two module-private components (`ReleaseItem`, `ReleaseList`), placed after Task 7's last exported helper (`catalogueReasonText`) and before `export function SettingsScreen`; ONE JSX line inside Task 7's module-private `UpdatesBody({ view, stale, now, reload })` (placed at the end of the file, after `SettingsScreen`), directly after its catalogue line — the `<p className={line.tone === 'calm' ? 'settings-catalogue' : …}>{line.text}</p>` that is the returned fragment's last child — and before the fragment's closing `</>`: `ul.settings-releases[aria-label="Releases"]`, one `li.settings-release[data-tag]` per release, newest first. Import additions are merged into the import lines Tasks 6–7 already wrote (Step 4 names each one)
- Modify: `pwa/src/fleet/fleet.css` — appended after its last line (Task 7's last appended rule): `.settings-releases`, `.settings-release`, `.settings-release-head`, `.settings-release-tag`, `.settings-release-date`, `.settings-badge`, `.settings-badge--dev`, `.settings-badge--stable`, `.settings-badge--verified`, `.settings-release-refused`, `.settings-release-notes` (`white-space: pre-wrap; overflow-wrap: anywhere;`), `.settings-release-actions`, `.btn-ghost.settings-move`, `.settings-move-note` *(correction: the skeleton listed nine classes; a row also needs a head, a tag, a date, a refused line and an actions row, and `.settings-move` is written `.btn-ghost.settings-move` — a layout-only override of the reused `.btn-ghost` primitive that wins by SPECIFICITY (0,2,0 over 0,1,0), never by sheet order, and that Task 9's node-row move buttons can carry unchanged; see Interfaces)*
- Modify: `pwa/design/audit.mjs` — three `INHERITED_GROUNDS` entries, `'fleet.css .settings-release-date'`, `'fleet.css .settings-release-refused'`, `'fleet.css .settings-move-note'`, each `under: ['var(--bg-page)']`, inserted directly before `INHERITED_GROUNDS`' closing `};` (`:746` at `d759c914`; the object opens at `:520`, its last entry is `'fleet.css .build-line-side--warn'` at `:742-745`, and any entry Task 7 appended sits after that). The four badge rules and `.settings-release-notes` are SELF-GROUNDED (each sets its own `background` and `color`) and need no entry. Measured on a scratch copy of `pwa/` at `d759c914` with exactly this task's CSS and these three entries: `node design/contrast-check.mjs` prints `ALL 578 PASS` (562 before) and the uncovered census stays `255`; with the CSS and WITHOUT the entries it prints `ALL 572 PASS` and `258`, the three selectors listed under `--uncovered`
- Test: `pwa/test/settings-screen.test.tsx` — two describes APPENDED after the file's last line: `'SettingsScreen — the release list: helpers'` and `'SettingsScreen — the release list: rendering (design 2026-09-20 §13)'`
- Run, not modified: `pwa/test/contrast.test.ts` (its `'contains no identities beyond the grandfathered blind spots'`, `:1160-1166`, reds on any of the three rules left unregistered; `'has no stale inherited registry entry'`, `:1226-1231`; `'gives a reason for every rule it exempts or hand-grounds'`, `:1233-1240`), `pwa/test/fleet-css.test.ts` (the `repeat(n, 1fr)` sweep, `:1189`), `node design/contrast-check.mjs`, `npm run build`. NOT run for R13: no file this task edits is cited by `session-hook.test.ts`'s corpus (the compaction-card spec, its plan A and `README.md`, `session-hook.test.ts:7073-7077`; its `FILE_RE` names `.ts|.mts|.mjs|.js|.sh` and the three documents hold no `audit.mjs:` token — measured at `d759c914`). No file is added, so `topology-clean.test.ts` is not owed

**Interfaces:**
- Consumes: `ReleaseWire` (`tag`, `version`, `channel: UpdateChannel | null`, `publishedAt` (epoch ms, `Date.parse(published_at)`, W2 Task 10), `commitSha`, `bundleListed`, `yanked`, `refused: ReleaseRefusalWire[]`, `notes: string | null`), `ReleaseRefusalWire { by: string; at: number }` (`by` = nodeId), `NodeWire.provenance`, `NodeWire.current`, `isReleaseTag`, `isUpdateChannel` (W2 Task 1, `shared/api.ts`); `compareReleaseTags(a, b): -1 | 0 | 1` (`1` = `a` newer) and `isNewerTag(a, b)` (W2 Task 2, `shared/semver.ts` — both throw `RangeError` on a non-tag, so every call sits behind `isReleaseTag`); Task 5's `nodeVersion` (`pwa/src/fleet/useUpdatesView.ts` — `n.current?.version` iff it passes `isReleaseTag`, else `null`) and `MOVE_DISABLED_TEXT` (`pwa/src/lib/api.ts`); Task 7's screen body — `SettingsScreen`'s one `const poll = useUpdatesView();`, handed through `UpdatesSection` to `UpdatesBody({ view, stale, now, reload })`, whose `view: UpdatesView` prop is NON-NULL there (the last good answer; `stale` says a later poll failed; `asUpdatesView` guarantees `releases`/`nodes` are arrays, their ELEMENTS pass through unchecked), and that body's catalogue line element; `.btn-ghost` (`pwa/src/components/primitives.css:258-280` — the tap floor, the border, and the `:disabled` ink already exempt at `audit.mjs:513`); `useId` (React 19, the `pwa/src/fleet/SessionLine.tsx:20`/`:352` precedent; Task 7's `'react'` import line already carries it); `declValue`, `ruleIn` (`pwa/test/cssRule.ts:139`, `:98` — `ruleIn` throws `no rule for <sel>`).
- Produces (exported from `SettingsScreen.tsx`):

```ts
/** Newest first by compareReleaseTags; a non-tag row sorts last, in wire order (Array.prototype.sort is stable,
 *  so numerically-equal tags — v0.0.10 / v0.0.010, both RELEASE_TAG-shaped — keep wire order too). */
export function sortReleases(releases: readonly ReleaseWire[]): ReleaseWire[];
/** true iff SOME node has provenance === 'verified' AND nodeVersion(node) === tag — never from bundleListed
 *  (the function takes no release, so it cannot read it). */
export function verifiedAt(tag: string, nodes: readonly NodeWire[]): boolean;
/** 'rollback' iff tag is a release tag, nodes is non-empty and EVERY node's nodeVersion is a tag newer than `tag`;
 *  else 'install' (an unversioned node is never "newer"; a non-tag row is never handed to the comparator). */
export function releaseDirection(tag: string, nodes: readonly NodeWire[]): 'install' | 'rollback';
/** `refused by ${n} of ${m} node${m === 1 ? '' : 's'}` with n = distinct refused[].by (elements without a string
 *  `by` ignored; a non-array refused reads as none), m = nodes.length; null when n = 0. */
export function refusedLine(r: ReleaseWire, nodes: readonly NodeWire[]): string | null;
/** "2026-09-23" — the UTC date of publishedAt (ms); '—' for a value Date cannot place (toISOString would throw). */
export function releaseDate(ms: number): string;
```

  *(corrections to the skeleton's block: `releaseDate` gains the `'—'` arm — `new Date(1e20).toISOString()` throws `RangeError`, and a malformed element must never crash the screen; `refusedLine` states its element guard, because `asUpdatesView` passes elements through unchecked and the global constraint wants every array read `Array.isArray`-guarded; `releaseDirection` states its non-tag arm, because `isNewerTag` throws on a non-tag.)*
- A row renders, in order: `span.settings-release-tag` `tag` · `span.settings-release-date` `releaseDate(publishedAt)` · a `span.settings-badge.settings-badge--<channel>` reading `dev`/`stable` iff `isUpdateChannel(channel)` (none for `null` or an unknown token) · `span.settings-badge.settings-badge--verified` `verified` iff `verifiedAt` · `span.settings-badge` `bundle listed` iff `bundleListed === true` · `span.settings-badge` `yanked` iff `yanked === true` · `p.settings-release-refused` `refusedLine` · the notes as `<pre className="settings-release-notes">{notes}</pre>` iff `notes` is a non-empty string (ONE React text child; nothing else touches it) · ONE move button — `Install` or `Roll back` by `releaseDirection` — `button.btn-ghost.settings-move[disabled]` whose `aria-describedby` names a `span.settings-move-note` (id from `useId()`) holding `MOVE_DISABLED_TEXT`. `releases: []` renders no list at all. The list carries `aria-label="Releases"` and every row `data-tag`, so tests scope inside it — Task 9's inventory renders the same tags as node versions, and its own disabled move buttons, on the same screen.
- Cases: `verified` appears with a node at `provenance: 'verified'` on that tag, and NOT from `bundleListed: true` alone (which renders `bundle listed`), and not from a verified node on another tag; `refused by 1 of 2 nodes`; notes containing `<b>bold</b>`, `<img src=x onerror=alert(1)>`, `https://example.com/x` and `javascript:alert(1)` render as the literal string (no `b`/`img`/`a`/`script` element inside the row, no `link`/`img` role); `v0.0.10` lists above `v0.0.9` whatever the wire order; `Roll back` when both nodes run a newer tag, `Install` when one is unversioned and on the equal tag; every move button is disabled and described by the sentence; the channel badges and the yanked badge; no list for no releases; a source scan of `SettingsScreen.tsx` finds no raw-HTML prop (UpdateBanner's own scan is Task 11's); the notes rule wraps (`pre-wrap`, `anywhere`).
- Spec §18 rows pinned: "`bundleListed` is never "verified"" (mutation: the badge reads the catalogue column beside `verifiedAt` → red), "notes are capped and plain" (the renderer half — mutation: render notes through a raw-HTML path → red; the cap is W2 Task 10's), "the move controls are disabled in W3" (mutation: drop `disabled` from the move button → red). Review Focus 3 (string order where semver is meant): mutations in `sortReleases` and `releaseDirection` → red. Global Constraints' CSS rule: an unregistered colour rule → `contrast.test.ts` red (Step 7, mutation 8).
- Correction to `w3-facts.json` (results[6], fact 10 / hazard 1): an unregistered colour rule does NOT land silently. It enters the uncovered census AND reds `contrast.test.ts`'s `'contains no identities beyond the grandfathered blind spots'` (`:1160-1166`, `additions` not in `GRANDFATHERED_UNCOVERED`, `:119-387`) — measured on the scratch copy by evaluating that test's predicate against `audit()`: with `'fleet.css .settings-release-refused'`'s entry removed, `report.uncovered` grows `255 → 256` and that key is the one new addition.

- [ ] **Step 1: Record the contrast audit's census before any edit**

Run: `cd pwa && node design/contrast-check.mjs | grep -E '^ALL [0-9]+ PASS$|rules set a colour with no ground'`
Expected: an `ALL <p> PASS` line and a `# <u> rules set a colour with no ground this auditor can recover …` line. Write both numbers down: `<u>` must be unchanged after Step 5 and `<p>` must rise by exactly 16 (eight new colour rules measured in two themes each — the five self-grounded rules and the three registered ones). At `d759c914` with no W3 CSS the two read `ALL 562 PASS` and `255`; after Tasks 6–7 they read whatever those tasks left, which is why this step measures rather than quotes.

- [ ] **Step 2: Write the failing tests**

Merge these names into `pwa/test/settings-screen.test.tsx`'s existing import lines (Task 6 created the file; Task 7 extended it) — add each name only to the line for its module, only if that line does not already import it, and create the line only when no line imports that module yet; a duplicated name is a TypeScript error under `npm run build`, and an unused one fails `noUnusedLocals` (`pwa/tsconfig.json` includes `test`):

```tsx
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { BuildInfo } from '../../shared/buildinfo';
import type { NodeWire, ReleaseWire, UpdatesView } from '../../shared/api';
import { FLEET_SCOPE } from '../../shared/api';
import {
  SettingsScreen, refusedLine, releaseDate, releaseDirection, sortReleases, verifiedAt,
} from '../src/screens/SettingsScreen';
import { MOVE_DISABLED_TEXT, api } from '../src/lib/api';
import { declValue, ruleIn } from './cssRule';
```

Then APPEND after the file's last line. Every fixture is prefixed `T8_`/`t8` and is module-level only because both describes share it, so no name collides with Tasks 6–7's (or 9–10's) helpers; the file's own full `afterEach` (Task 6, `accounts-screen.test.tsx:46-51`'s four resets — `cleanup()`, `vi.restoreAllMocks()`, `navigate('/')`, the `useFleetStore` reset) covers both describes.

```tsx
// ── Task 8: the release list (design 2026-09-20 §13, §18) ────────────────────
// Fixtures are local to these two describes on purpose: Tasks 7, 9 and 10 each
// keep their own, and a shared `node()` would couple four tasks' cases to one
// shape nobody owns.
const T8_T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const T8_NODE_A = '11111111-1111-4111-8111-111111111111';
const T8_NODE_B = '22222222-2222-4222-8222-222222222222';
/** A stamp at `version`; `undefined` = an unversioned (deploy.sh) build — the key is ABSENT, as the parser leaves it. */
const t8Stamp = (version: string | undefined): BuildInfo => ({
  sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false,
  ...(version === undefined ? {} : { version }),
});
/** A full NodeWire, every field W2 Task 1 declares, measured and settled. */
const t8Node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: T8_NODE_A, role: 'fleet', label: 'fleet', os: 'linux',
  current: t8Stamp('v0.0.9'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor', 'update-gate'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  measuredAt: T8_T0, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const t8Server = (over: Partial<NodeWire> = {}): NodeWire =>
  t8Node({ nodeId: T8_NODE_B, role: 'server', label: 'server', agentOps: null, ...over });
/** A full ReleaseWire; `version` is the tag (W2 Task 4: `version = tag`). */
const t8Release = (tag: string, over: Partial<ReleaseWire> = {}): ReleaseWire => ({
  tag, version: tag, channel: 'stable', publishedAt: T8_T0, commitSha: 'c'.repeat(40),
  bundleListed: true, yanked: false, refused: [], notes: null, ...over,
});

describe('SettingsScreen — the release list: helpers', () => {
  it('sortReleases: semver order, newest first — v0.0.10 above v0.0.9 — and a non-tag row last, in wire order', () => {
    const wire = [t8Release('v0.0.9'), t8Release('vnext'), t8Release('v0.0.10'), t8Release('v0.1.0'), t8Release('v0.0.8 ')];
    expect(sortReleases(wire).map((r) => r.tag)).toEqual(['v0.1.0', 'v0.0.10', 'v0.0.9', 'vnext', 'v0.0.8 ']);
    // The input is not reordered in place: the view the poll holds is shared state.
    expect(wire.map((r) => r.tag)).toEqual(['v0.0.9', 'vnext', 'v0.0.10', 'v0.1.0', 'v0.0.8 ']);
  });

  it('verifiedAt: only a node MEASURED verified and running THAT tag — provenance alone or the tag alone is not enough', () => {
    expect(verifiedAt('v0.0.9', [t8Node()])).toBe(true);
    expect(verifiedAt('v0.0.9', [t8Node({ provenance: 'unverified' }), t8Server({ provenance: 'unknown' })])).toBe(false);
    expect(verifiedAt('v0.0.9', [t8Node({ current: t8Stamp('v0.0.8') })])).toBe(false);
    expect(verifiedAt('v0.0.9', [t8Node({ current: null })])).toBe(false);
    expect(verifiedAt('v0.0.9', [])).toBe(false);
  });

  it('releaseDirection: Roll back only when EVERY node runs a newer tag, compared by semver across v0.0.9/v0.0.10', () => {
    const both10 = [t8Node({ current: t8Stamp('v0.0.10') }), t8Server({ current: t8Stamp('v0.0.10') })];
    expect(releaseDirection('v0.0.9', both10)).toBe('rollback');          // string order would call v0.0.10 older
    expect(releaseDirection('v0.0.10', both10)).toBe('install');          // equal is not newer
    expect(releaseDirection('v0.0.9', [both10[0]!, t8Server({ current: t8Stamp(undefined) })])).toBe('install');
    expect(releaseDirection('v0.0.9', [both10[0]!, t8Server({ current: null, measuredAt: null })])).toBe('install');
    expect(releaseDirection('v0.0.9', [])).toBe('install');
    expect(releaseDirection('vnext', both10)).toBe('install');           // never handed to the comparator, which throws
  });

  it('refusedLine: distinct refusing nodes out of the live count; null with no refusal; a malformed element is ignored', () => {
    const two = [t8Node(), t8Server()];
    expect(refusedLine(t8Release('v0.0.9'), two)).toBeNull();
    expect(refusedLine(t8Release('v0.0.9', { refused: [{ by: T8_NODE_A, at: T8_T0 }] }), two)).toBe('refused by 1 of 2 nodes');
    expect(refusedLine(t8Release('v0.0.9', {
      refused: [{ by: T8_NODE_A, at: T8_T0 }, { by: T8_NODE_A, at: T8_T0 + 1 }, { by: T8_NODE_B, at: T8_T0 + 2 }],
    }), two)).toBe('refused by 2 of 2 nodes');
    expect(refusedLine(t8Release('v0.0.9', { refused: [{ by: T8_NODE_A, at: T8_T0 }] }), [t8Node()])).toBe('refused by 1 of 1 node');
    expect(refusedLine(t8Release('v0.0.9', { refused: {} as unknown as ReleaseWire['refused'] }), two)).toBeNull();
    expect(refusedLine(t8Release('v0.0.9', { refused: [null, { at: 1 }] as unknown as ReleaseWire['refused'] }), two)).toBeNull();
  });

  it('releaseDate: the UTC calendar day; a time Date cannot place is the missing mark, never a throw', () => {
    expect(releaseDate(Date.UTC(2026, 8, 23, 23, 59))).toBe('2026-09-23');
    expect(releaseDate(Date.UTC(2026, 8, 24, 0, 0))).toBe('2026-09-24');
    expect(releaseDate(Number.NaN)).toBe('—');
    expect(releaseDate(1e20)).toBe('—');
  });
});

describe('SettingsScreen — the release list: rendering (design 2026-09-20 §13)', () => {
  const view = (releases: ReleaseWire[], nodes: NodeWire[]): UpdatesView => ({
    catalogue: { lastOkAt: T8_T0, lastError: null },
    releases,
    nodes,
    intent: [{ scope: FLEET_SCOPE, channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: T8_T0, setBy: 'test' }],
  });
  /** Render the screen over one answer and return the release list — every case reads INSIDE it, because the
   *  inventory (Task 9) renders the same tags as node versions on the same screen. */
  const renderList = async (releases: ReleaseWire[], nodes: NodeWire[]): Promise<HTMLElement> => {
    vi.spyOn(api, 'updates').mockResolvedValue(view(releases, nodes));
    render(<SettingsScreen />);
    return screen.findByRole('list', { name: 'Releases' });
  };
  const rowOf = (list: HTMLElement, tag: string): HTMLElement => {
    const row = list.querySelector<HTMLElement>(`li[data-tag="${tag}"]`);
    if (row === null) throw new Error(`no release row for ${tag}`);
    return row;
  };

  it('renders "verified" when a node is measured verified at that tag (§18 "bundleListed is never verified")', async () => {
    const list = await renderList([t8Release('v0.0.9')], [t8Node(), t8Server({ provenance: 'unverified' })]);
    const row = rowOf(list, 'v0.0.9');
    expect(within(row).getByText('verified')).toHaveClass('settings-badge--verified');
    expect(within(row).getByText('bundle listed')).toBeInTheDocument();
  });

  it('bundle listed alone renders "bundle listed", never "verified"', async () => {
    const list = await renderList(
      [t8Release('v0.0.9', { bundleListed: true })],
      [t8Node({ provenance: 'unverified' }), t8Server({ provenance: 'unknown' })],
    );
    const row = rowOf(list, 'v0.0.9');
    expect(within(row).getByText('bundle listed')).toBeInTheDocument();
    expect(within(row).queryByText('verified')).toBeNull();
    expect(row.querySelector('.settings-badge--verified')).toBeNull();
  });

  it('a node verified on ANOTHER tag does not verify this one', async () => {
    const list = await renderList(
      [t8Release('v0.0.9'), t8Release('v0.0.8')],
      [t8Node({ current: t8Stamp('v0.0.8') }), t8Server({ current: t8Stamp('v0.0.8'), provenance: 'unverified' })],
    );
    expect(within(rowOf(list, 'v0.0.9')).queryByText('verified')).toBeNull();
    expect(within(rowOf(list, 'v0.0.8')).getByText('verified')).toBeInTheDocument();
  });

  it('reads "refused by 1 of 2 nodes" off refused[]', async () => {
    const list = await renderList(
      [t8Release('v0.0.9', { refused: [{ by: T8_NODE_B, at: T8_T0 }] })],
      [t8Node(), t8Server()],
    );
    expect(within(rowOf(list, 'v0.0.9')).getByText('refused by 1 of 2 nodes')).toHaveClass('settings-release-refused');
  });

  it('renders notes as literal text — no markup, no image, no link (§18 "notes are capped and plain")', async () => {
    const NOTES = '<b>bold</b> <img src=x onerror=alert(1)>\nsee https://example.com/x or javascript:alert(1)';
    const list = await renderList([t8Release('v0.0.9', { notes: NOTES })], [t8Node()]);
    const row = rowOf(list, 'v0.0.9');
    const pre = row.querySelector('pre.settings-release-notes');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe(NOTES);
    expect(row.querySelector('b, img, a, script')).toBeNull();
    expect(within(row).queryByRole('link')).toBeNull();
    expect(within(row).queryByRole('img')).toBeNull();
  });

  it('lists v0.0.10 above v0.0.9 whatever order the wire carries (semver, never string order)', async () => {
    const list = await renderList(
      [t8Release('v0.0.9', { publishedAt: T8_T0 + 5 }), t8Release('v0.0.10', { publishedAt: T8_T0 })],
      [t8Node()],
    );
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('data-tag'))).toEqual(['v0.0.10', 'v0.0.9']);
  });

  it('names the move by direction: Roll back when every node runs a newer tag, Install otherwise', async () => {
    const list = await renderList(
      [t8Release('v0.0.10'), t8Release('v0.0.9')],
      [t8Node({ current: t8Stamp('v0.0.10') }), t8Server({ current: t8Stamp('v0.0.10') })],
    );
    expect(within(rowOf(list, 'v0.0.9')).getByRole('button', { name: 'Roll back' })).toBeInTheDocument();
    expect(within(rowOf(list, 'v0.0.10')).getByRole('button', { name: 'Install' })).toBeInTheDocument();
  });

  it('an unversioned node makes the move Install, never Roll back', async () => {
    const list = await renderList(
      [t8Release('v0.0.9')],
      [t8Node({ current: t8Stamp('v0.0.10') }), t8Server({ current: t8Stamp(undefined), provenance: 'unknown' })],
    );
    expect(within(rowOf(list, 'v0.0.9')).getByRole('button', { name: 'Install' })).toBeInTheDocument();
  });

  it('renders every move button DISABLED, described by the one W3 sentence (§18 "the move controls are disabled in W3")', async () => {
    const list = await renderList(
      [t8Release('v0.0.10'), t8Release('v0.0.9'), t8Release('v0.0.8', { channel: 'dev' })],
      [t8Node({ current: t8Stamp('v0.0.9') }), t8Server({ current: t8Stamp('v0.0.9') })],
    );
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Install', 'Install', 'Roll back']);
    for (const b of buttons) {
      expect(b).toBeDisabled();
      expect(b).toHaveAccessibleDescription(MOVE_DISABLED_TEXT);
    }
    expect(within(list).getAllByText(MOVE_DISABLED_TEXT)).toHaveLength(3);
  });

  it('badges the channel (dev / stable, none for an unknown one) and marks a yanked release', async () => {
    const list = await renderList(
      [
        t8Release('v0.0.11', { channel: 'dev' }),
        t8Release('v0.0.10', { channel: 'stable', yanked: true }),
        t8Release('v0.0.9', { channel: null }),
      ],
      [t8Node({ provenance: 'unknown' })],
    );
    expect(within(rowOf(list, 'v0.0.11')).getByText('dev')).toHaveClass('settings-badge', 'settings-badge--dev');
    expect(within(rowOf(list, 'v0.0.10')).getByText('stable')).toHaveClass('settings-badge', 'settings-badge--stable');
    expect(within(rowOf(list, 'v0.0.10')).getByText('yanked')).toHaveClass('settings-badge');
    const unknown = rowOf(list, 'v0.0.9');
    expect(unknown.querySelector('.settings-badge--dev, .settings-badge--stable')).toBeNull();
    expect(within(unknown).queryByText('yanked')).toBeNull();
    expect(within(rowOf(list, 'v0.0.11')).getByText('2026-09-23')).toHaveClass('settings-release-date');
  });

  it('renders no release list when the catalogue holds no release', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(view([], [t8Node()]));
    render(<SettingsScreen />);
    await screen.findByText(/^checked /);   // Task 7's calm catalogue line: the view HAS landed, so absence is measured
    expect(screen.queryByRole('list', { name: 'Releases' })).toBeNull();
  });

  it('spells no raw-HTML path anywhere in the screen (a literal-absence pin over the source)', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
    expect(src).not.toMatch(/\binnerHTML\b/);
  });

  it('wraps the notes block inside the phone width (a <pre> that keeps newlines and breaks a long URL)', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
    const rule = ruleIn(css, '.settings-release-notes');
    expect(declValue(rule, 'white-space')).toBe('pre-wrap');
    expect(declValue(rule, 'overflow-wrap')).toBe('anywhere');
  });
});
```

- [ ] **Step 3: Run the new describes to verify they fail**

Run: `cd pwa && ./node_modules/.bin/vitest run test/settings-screen.test.tsx -t 'the release list'` (foreground; `npm ci` first if `pwa/node_modules` is absent)
Expected: FAIL — 16 of the 18 new cases red, 2 green (derived from the file's cases, not measured). The five helper cases fail with a `TypeError` whose message ends `is not a function` (vitest strips types, so the missing exports `sortReleases`, `verifiedAt`, `releaseDirection`, `refusedLine`, `releaseDate` arrive `undefined`); the ten list-rendering cases time out in `findByRole` with `Unable to find role="list" and name "Releases"`; the CSS case fails with `no rule for .settings-release-notes`. Two cases PASS already, by construction, and get their teeth in Step 7: `renders no release list when the catalogue holds no release` (nothing renders a list yet — mutation 7) and `spells no raw-HTML path anywhere in the screen` (a literal-absence pin — mutation 3). Every Task 6–7 case in the file stays green: `./node_modules/.bin/vitest run test/settings-screen.test.tsx` shows no failure outside the two new describes.

- [ ] **Step 4: Implement the release list in `pwa/src/screens/SettingsScreen.tsx`**

Merge the imports into the lines Tasks 6–7 wrote (one name per module line, never a second line for a module already imported; create a line only for a module not yet imported):
- `'react'` — nothing to add: Task 7's `import { useId, useState } from 'react';` already carries `useId`, and Task 6's shell's `import type { ReactNode } from 'react';` carries `ReactNode`;
- the type import from `'../../../shared/api'` (Task 7's `AutoMode, CatalogueErrorReason, CatalogueState, NodeWire, UpdateChannel, UpdateRouteError, UpdateRouteRefusal, UpdatesView`) — add `ReleaseWire`;
- the value import from `'../../../shared/api'` (Task 7's `AUTO_MODES`, `FLEET_SCOPE`, `UPDATE_CHANNELS`, `UPDATE_GATE_CAP`) — add `isReleaseTag`, `isUpdateChannel`;
- a NEW line `import { compareReleaseTags, isNewerTag } from '../../../shared/semver';` beside the shared imports (no earlier task imports `shared/semver` into this file);
- the `'../lib/api'` import (Task 7's `ApiError`, `api`, `updateErrorText`) — add `MOVE_DISABLED_TEXT`;
- the `'../fleet/useUpdatesView'` import (Task 7's `useUpdatesView, type UpdatesPoll`) — add `nodeVersion`.

Insert after Task 7's `export function catalogueReasonText(…)` and before `export function SettingsScreen`:

```tsx
// ── The release list (spec §13; programme wave 3 Task 8) ─────────────────────
// One row per catalogue release, newest first. Three rules this block exists
// to keep, each pinned in settings-screen.test.tsx:
//   * ORDER IS SEMVER. `v0.0.10` sorts below `v0.0.9` as a string; every tag
//     comparison here goes through shared/semver.ts behind isReleaseTag (the
//     comparator throws RangeError on a non-tag, so nothing unvalidated reaches it).
//   * "verified" IS A MEASUREMENT. It appears only when some node's measured
//     provenance is `verified` while that node runs this tag. `bundleListed` is
//     the catalogue's claim that a bundle FILE is listed, and renders as
//     `bundle listed` — verifiedAt takes no release, so it cannot read it (§18).
//   * NOTES ARE TEXT. Same-user-writable, capped by the poller (W2), and handed
//     to React as one text child of a <pre>: no markdown pass, no HTML, no link
//     detection, and no raw-HTML prop anywhere in this file (a source scan
//     holds that literally).
// The move button is rendered and DISABLED in this wave: its routes are
// programme wave 5's, and MOVE_DISABLED_TEXT is the one sentence every
// disabled move control carries (Task 5).

export function sortReleases(releases: readonly ReleaseWire[]): ReleaseWire[] {
  const tagged = releases.filter((r) => isReleaseTag(r.tag));
  const rest = releases.filter((r) => !isReleaseTag(r.tag));
  // `filter` returned a fresh array, so the stable in-place sort never reorders
  // the poll's view; equal versions (v0.0.10 / v0.0.010) keep wire order.
  tagged.sort((a, b) => compareReleaseTags(b.tag, a.tag));
  return [...tagged, ...rest];
}

export function verifiedAt(tag: string, nodes: readonly NodeWire[]): boolean {
  return nodes.some((n) => n.provenance === 'verified' && nodeVersion(n) === tag);
}

export function releaseDirection(tag: string, nodes: readonly NodeWire[]): 'install' | 'rollback' {
  if (!isReleaseTag(tag) || nodes.length === 0) return 'install';
  return nodes.every((n) => {
    const v = nodeVersion(n);
    return v !== null && isNewerTag(v, tag);
  }) ? 'rollback' : 'install';
}

export function refusedLine(r: ReleaseWire, nodes: readonly NodeWire[]): string | null {
  const refused: readonly unknown[] = Array.isArray(r.refused) ? r.refused : [];
  const by = new Set<string>();
  for (const x of refused) {
    if (typeof x === 'object' && x !== null && typeof (x as { by?: unknown }).by === 'string') {
      by.add((x as { by: string }).by);
    }
  }
  if (by.size === 0) return null;
  const m = nodes.length;
  return `refused by ${by.size} of ${m} node${m === 1 ? '' : 's'}`;
}

export function releaseDate(ms: number): string {
  const d = new Date(typeof ms === 'number' ? ms : Number.NaN);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

function ReleaseItem({ release: r, nodes }: { release: ReleaseWire; nodes: readonly NodeWire[] }): ReactNode {
  const noteId = useId();
  const refused = refusedLine(r, nodes);
  const direction = releaseDirection(r.tag, nodes);
  return (
    <li className="settings-release" data-tag={r.tag}>
      <div className="settings-release-head">
        <span className="settings-release-tag">{r.tag}</span>
        <span className="settings-release-date">{releaseDate(r.publishedAt)}</span>
        {isUpdateChannel(r.channel) && (
          <span className={`settings-badge settings-badge--${r.channel}`}>{r.channel}</span>
        )}
        {verifiedAt(r.tag, nodes) && <span className="settings-badge settings-badge--verified">verified</span>}
        {r.bundleListed === true && <span className="settings-badge">bundle listed</span>}
        {r.yanked === true && <span className="settings-badge">yanked</span>}
      </div>
      {refused !== null && <p className="settings-release-refused">{refused}</p>}
      {typeof r.notes === 'string' && r.notes !== '' && <pre className="settings-release-notes">{r.notes}</pre>}
      <div className="settings-release-actions">
        <button type="button" className="btn-ghost settings-move" disabled aria-describedby={noteId}>
          {direction === 'rollback' ? 'Roll back' : 'Install'}
        </button>
        <span id={noteId} className="settings-move-note">{MOVE_DISABLED_TEXT}</span>
      </div>
    </li>
  );
}

function ReleaseList({ releases, nodes }: { releases: readonly ReleaseWire[]; nodes: readonly NodeWire[] }): ReactNode {
  if (releases.length === 0) return null;
  return (
    <ul className="settings-releases" aria-label="Releases">
      {sortReleases(releases).map((r) => <ReleaseItem key={r.tag} release={r} nodes={nodes} />)}
    </ul>
  );
}
```

Then, in Task 7's `UpdatesBody({ view, stale, now, reload })` (at the end of the file), add ONE line directly after its catalogue line — the `<p className={line.tone === 'calm' ? 'settings-catalogue' : …}>{line.text}</p>` element, the returned fragment's last child — and before the fragment's closing `</>`. It reads the `view` prop, the screen's one `useUpdatesView()` answer that `UpdatesSection` hands down; this task adds no second poll. The line is exactly:

```tsx
      {view !== null && <ReleaseList releases={view.releases} nodes={view.nodes} />}
```

`view` is typed `UpdatesView` (non-null) inside `UpdatesBody` — `UpdatesSection` renders the body only when a view has landed, and renders Task 7's `not-configured` / first-read-failed sentence or its `Skeleton` otherwise, so no list appears before an answer; a later failure keeps the last good view's list, under Task 7's stale note. The `!== null` guard is therefore a no-op there (TypeScript accepts a `null` comparison on any type), kept byte-for-byte because Task 9 anchors its own insert on this exact line. No `useNow` is read here — the date is a calendar day, not an age. `releases.tag` is the table's primary key (W2 Task 3), so `key={r.tag}` is unique.

- [ ] **Step 5: Append the CSS and register the three inherited grounds**

Append to `pwa/src/fleet/fleet.css`, after its last line:

```css

/* — centralised update management W3, Task 8: the release list —
   One row per catalogue release, newest first by semver. The row paints no
   ground of its own (a hairline between rows, the .hotfiles-row shape), so
   every rule below that sets `color` and no `background` is registered in
   design/audit.mjs's INHERITED_GROUNDS against --bg-page: .settings-screen
   paints nothing, and neither do .shell-detail's ancestors, so body's
   --bg-page is what is behind the text. The badges and the notes block are
   self-grounded (each sets its own background AND colour) so the auditor
   measures them without a registration. */
.settings-releases { list-style: none; margin: 0; padding: 0; display: grid; }
.settings-release {
  display: grid;
  gap: var(--sp-2);
  min-width: 0;
  padding: var(--sp-2) 0;
  border-top: 1px solid var(--edge-subtle);
}
.settings-release-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); min-width: 0; }
.settings-release-tag { font: var(--weight-medium) var(--text-sm) / 1 var(--font-mono); }
.settings-release-date { font: var(--weight-regular) var(--text-xs) / 1 var(--font-mono); color: var(--ink-tertiary); }
.settings-badge {
  padding: 2px var(--sp-2);
  border: 1px solid var(--edge-subtle);
  border-radius: var(--r-full);
  background: var(--bg-raised);
  color: var(--ink-secondary);
  font: var(--weight-medium) var(--text-2xs) / 1.4 var(--font-mono);
  white-space: nowrap;
}
/* Each variant restates its ground: a variant selector names no painted
   ancestor, so a colour-only override would be measured at nothing. */
.settings-badge--dev { background: var(--bg-raised); color: var(--ink-secondary); }
.settings-badge--stable { background: var(--bg-raised); color: var(--ink-primary); }
/* Green only for a MEASURED verdict — some node's provenance at this tag —
   never for `bundle listed`, which keeps the base badge's quiet ink. */
.settings-badge--verified { background: var(--bg-raised); color: var(--status-busy-text); }
.settings-release-refused { margin: 0; font-size: var(--text-xs); color: var(--status-attention-text); }
/* Notes are untrusted same-user text, rendered as ONE text child: wrapping
   keeps a long line or an unbroken URL inside the phone's width, and there is
   no markdown, HTML or link pass anywhere on this path. */
.settings-release-notes {
  margin: 0;
  padding: var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  color: var(--ink-secondary);
  font: var(--weight-regular) var(--text-xs) / var(--leading-normal) var(--font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.settings-release-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
/* `.btn-ghost` (primitives.css) supplies the tap floor, the border and the
   disabled ink; this only stops it filling the row. Compound on purpose: it
   wins .btn-ghost's `width: 100%` by SPECIFICITY (0,2,0 over 0,1,0), not by
   which sheet loads last, and any disabled move button on this screen (the
   node rows' Update / Roll back too) can carry the same pair of classes. */
.btn-ghost.settings-move { width: auto; padding: 0 var(--sp-3); }
.settings-move-note { font-size: var(--text-2xs); color: var(--ink-tertiary); }
```

In `pwa/design/audit.mjs`, directly before `INHERITED_GROUNDS`' closing `};` (after the last entry — `'fleet.css .build-line-side--warn'` at `d759c914`, or whatever Task 7 appended after it):

```js
  // ── centralised update management W3, Task 8: the release list ──────────
  'fleet.css .settings-release-date': {
    under: ['var(--bg-page)'],
    why: "the release row's publish date on SettingsScreen. .settings-release draws a hairline and no fill, .settings-section/.settings-screen paint no background, and neither does .shell-detail, so body's --bg-page (styles/base.css:111) is behind it — the .pool-epoch-lag reasoning. Its selector names no painted ancestor",
  },
  'fleet.css .settings-release-refused': {
    under: ['var(--bg-page)'],
    why: "the 'refused by N of M nodes' line in the same unfilled release row, retinted to --status-attention-text. Same ground and same reason as .settings-release-date; registered separately because it sets its own colour",
  },
  'fleet.css .settings-move-note': {
    under: ['var(--bg-page)'],
    why: "the 'lands with the next release (W4)' note beside a disabled Install/Roll back button, in the same unfilled release row (and in any other unfilled row of this screen that reuses it). Same ground as .settings-release-date; the NOTE is live text and is measured, unlike the disabled button beside it (primitives.css .btn-ghost:disabled, WCAG 1.4.3)",
  },
```

Run: `cd pwa && node design/contrast-check.mjs | grep -E '^ALL [0-9]+ PASS$|rules set a colour with no ground|settings-(badge|release|move)'`
Expected: `ALL <p+16> PASS` (Step 1's `<p>` plus 16), the uncovered line still reading Step 1's `<u>`, and sixteen `PASS` rows for this task's rules — measured on a scratch copy of `pwa/` at `d759c914` with this exact CSS: `.settings-badge` 7.91 dark / 6.32 light, `.settings-badge--dev` the same, `.settings-badge--stable` 14.32 / 14.15, `.settings-badge--verified` 9.77 / 5.41, `.settings-release-notes` 8.67 / 7.41, `.settings-release-date` and `.settings-move-note` 6.23 / 5.25, `.settings-release-refused` 10.89 / 5.45. Then `node design/contrast-check.mjs --uncovered | grep -E '^#   fleet\.css \.settings-(release|badge|move)'` prints nothing (no census line for this task's selectors).

- [ ] **Step 6: Run green**

Run, one at a time, foreground, from `pwa/`:
`./node_modules/.bin/vitest run test/settings-screen.test.tsx` → PASS, every case (the 18 new ones — five helper cases, thirteen rendering cases — and every Task 6–7 case)
`./node_modules/.bin/vitest run test/contrast.test.ts test/fleet-css.test.ts` → PASS (`contrast.test.ts`'s grandfathered-census case, its "has no stale inherited registry entry" and its "gives a reason for every rule it exempts or hand-grounds" read the three new entries)
`node design/contrast-check.mjs` → exit 0, `ALL <p+16> PASS`
`npm run build` → `tsc --noEmit` clean, then the Vite build (a duplicated or unused import from Step 2's or Step 4's merge fails here, not in vitest, which strips types)

- [ ] **Step 7: Mutation measurement (spec §18 rows "`bundleListed` is never "verified"", "notes are capped and plain", "the move controls are disabled in W3"; Review Focus 3; the CSS registration rule)**

Each mutation is one hand edit, the named case run red, then the edit reversed by hand (never `git checkout --`, which would discard this task's uncommitted work) and the restore confirmed by `grep -c` on the original text printing the stated count. Mutations 1–7 edit `pwa/src/screens/SettingsScreen.tsx` and run `./node_modules/.bin/vitest run test/settings-screen.test.tsx -t 'the release list'`; mutation 8 edits `pwa/design/audit.mjs` and runs `./node_modules/.bin/vitest run test/contrast.test.ts`. All from `pwa/`.

1. §18 "`bundleListed` is never "verified"" (the spec row's mutation: "the badge reads the catalogue column") — change `{verifiedAt(r.tag, nodes) && <span className="settings-badge settings-badge--verified">` to `{(verifiedAt(r.tag, nodes) || r.bundleListed === true) && <span className="settings-badge settings-badge--verified">` → RED: `bundle listed alone renders "bundle listed", never "verified"` (`queryByText('verified')` finds the badge). This mutates the CALL SITE because `verifiedAt` takes no release and cannot read the column. Reverse; `grep -c '{verifiedAt(r.tag, nodes) && <span' src/screens/SettingsScreen.tsx` → `1`.
2. Same row, the tag half — in `verifiedAt`, change `n.provenance === 'verified' && nodeVersion(n) === tag` to `n.provenance === 'verified'` → RED: `verifiedAt: only a node MEASURED verified and running THAT tag …` and `a node verified on ANOTHER tag does not verify this one`. Reverse; `grep -c "n.provenance === 'verified' && nodeVersion(n) === tag" src/screens/SettingsScreen.tsx` → `1`.
3. §18 "notes are capped and plain" (the renderer) — replace `<pre className="settings-release-notes">{r.notes}</pre>` with `<pre className="settings-release-notes" dangerouslySetInnerHTML={{ __html: r.notes }} />` → RED twice: `renders notes as literal text …` (a `b` and an `img` element appear inside the row, and `textContent` loses the tags) and `spells no raw-HTML path anywhere in the screen …`. Reverse; `grep -c 'className="settings-release-notes">{r.notes}</pre>' src/screens/SettingsScreen.tsx` → `1`, and `grep -c dangerouslySetInnerHTML src/screens/SettingsScreen.tsx` → `0`.
4. §18 "the move controls are disabled in W3" — delete ` disabled` from `className="btn-ghost settings-move" disabled aria-describedby={noteId}` → RED: `renders every move button DISABLED …` (`toBeDisabled` fails on the first button). Reverse; `grep -c 'className="btn-ghost settings-move" disabled aria-describedby={noteId}' src/screens/SettingsScreen.tsx` → `1`.
5. Review Focus 3, the list — in `sortReleases`, replace `compareReleaseTags(b.tag, a.tag)` with `(b.tag < a.tag ? -1 : b.tag > a.tag ? 1 : 0)` → RED: the `sortReleases` helper case and `lists v0.0.10 above v0.0.9 …` (descending string order puts `v0.0.9` above `v0.0.10`). Reverse; `grep -c 'tagged.sort((a, b) => compareReleaseTags(b.tag, a.tag));' src/screens/SettingsScreen.tsx` → `1`.
6. Review Focus 3, the direction — in `releaseDirection`, replace `isNewerTag(v, tag)` with `v > tag` → RED: the `releaseDirection` helper case (`'v0.0.10' > 'v0.0.9'` is false as strings) and `names the move by direction …`. Reverse; `grep -c 'return v !== null && isNewerTag(v, tag);' src/screens/SettingsScreen.tsx` → `1`.
7. The empty-list control (the "no release list" case was green in Step 3, so its teeth are measured here) — in `ReleaseList`, delete the line `  if (releases.length === 0) return null;` → RED: `renders no release list when the catalogue holds no release` (an empty `ul` named `Releases` renders). Reverse; `grep -c '  if (releases.length === 0) return null;' src/screens/SettingsScreen.tsx` → `1`.
8. Global Constraints' CSS rule (a colour rule over an unpainted ancestor is registered) — in `design/audit.mjs`, delete the four-line `'fleet.css .settings-release-refused': { … },` entry → RED: `contrast.test.ts`'s `'contains no identities beyond the grandfathered blind spots'` (`additions` is `['fleet.css .settings-release-refused']`; measured on the scratch copy: the census reads `256` against Step 1's `255`, and `node design/contrast-check.mjs` prints `ALL 576 PASS`, two measurements fewer). Reverse; `grep -c "'fleet.css .settings-release-refused': {" design/audit.mjs` → `1`, and `node design/contrast-check.mjs | grep -E '^ALL'` → Step 5's `ALL <p+16> PASS`.

After the last reversal, `./node_modules/.bin/vitest run test/settings-screen.test.tsx test/contrast.test.ts` is green again with the Step 6 counts, and `git diff --stat` lists only the four files this task edits.

- [ ] **Step 8: Commit**

```bash
git add pwa/src/screens/SettingsScreen.tsx pwa/src/fleet/fleet.css pwa/design/audit.mjs pwa/test/settings-screen.test.tsx
git commit -m "feat(update): the release list on /settings — semver order, verified only from a measured node, notes as plain text, the move control disabled until W4"
```

### Task 9: SettingsScreen — the node inventory

**Files:**
- Modify: `pwa/src/screens/SettingsScreen.tsx` — two exported constants (`MACOS_UNMANAGED_TEXT`, `ACK_UNREADABLE_TEXT`), six exported helpers (`currentText`, `currentIsAmber`, `canAck`, `requestLine`, `nodeStateLine`, `reachabilityLine`) and two module-private components (`NodeList`, `NodeItem`) placed after Task 8's `function ReleaseList(…)` and before `export function SettingsScreen`; ONE JSX line inside the Updates section directly after Task 8's `{view !== null && <ReleaseList releases={view.releases} nodes={view.nodes} />}`: `ul.settings-nodes[aria-label="Nodes"]`, one `li.settings-node[data-node-id]` per `view.nodes` entry, in W2's order (`nodes()`: `ORDER BY label, nodeId`, never re-sorted here). Import additions are merged into the import lines Tasks 6–8 already wrote (Step 5 names each one)
- Modify: `pwa/src/fleet/useUpdatesView.ts` — `pendingTag` gains ONE guard line, `if (n.stampRead !== 'ok') return null;`, directly after its `if (!isUpdateChannel(n.channel)) return null;` line, and its docstring's last sentence is replaced (Step 4) *(correction — see Interfaces: without it spec §13's pin "a node with `stampRead: 'unreadable'` renders amber and no arrow" cannot hold, because Task 5's predicate reads a NULL `current` as "unversioned, points up")* (D-3307), and a SECOND guard line, `if (n.os === 'darwin') return null;`, directly after the first *(correction found reviewing Task 11: a macOS node is not centrally managed, and with the Darwin clause only in this task's row, the banner (Task 11) and BuildLine (Task 12) — which read `pendingTag` directly — would draw an arrow and offer "Update all" for a node whose row says it is not managed)* (D-3309)
- Modify: `pwa/src/fleet/fleet.css` — appended after the last line (Task 8's `.settings-move-note` rule): `.settings-nodes`, `.settings-node`, `.settings-node-head`, `.settings-node-label`, `.settings-node-versions`, `.settings-node-current`, `.settings-node-current--amber`, `.settings-node-desired`, `.settings-node-detail`, `.settings-node-actions` *(correction: the skeleton listed five classes; the row also needs a head, a label, a versions line, the current cell's own hook and the desired cell. It needs NO inline-button override of its own: the three row buttons carry the `btn-ghost settings-move` pair, and Task 8's compound `.btn-ghost.settings-move` rule — written compound precisely so "Task 9's node-row move buttons can carry [it] unchanged" — already stops `.btn-ghost` filling the row; a descendant copy here would be a second, identical override of one rule)*
- Modify: `pwa/design/audit.mjs` — two `INHERITED_GROUNDS` entries, `'fleet.css .settings-node-current--amber'` and `'fleet.css .settings-node-detail'`, each `under: ['var(--bg-page)']`, inserted directly before `INHERITED_GROUNDS`' closing `};` (after Task 8's `'fleet.css .settings-move-note'` entry). They are the only two new rules that set `color`; the desired cell reuses Task 8's self-grounded `.settings-badge--<channel>` rules and the move row reuses Task 8's registered `.settings-move-note` — measured: with Task 8's CSS and entries plus this task's on a copy of `pwa/` at `d759c914`, `node design/contrast-check.mjs` printed `ALL 582 PASS` (578 after Task 8 alone) and the uncovered census stayed `255`
- Test: `pwa/test/settings-screen.test.tsx` — two describes APPENDED after the file's last line: `'SettingsScreen — the node inventory: helpers'` and `'SettingsScreen — the node inventory: rendering (design 2026-09-20 §13)'`; `pwa/test/use-updates-view.test.tsx` — two describes APPENDED after the file's last line (Task 5's `useUpdatesView — the one poll of /api/updates` describe): `'pendingTag — a stamp that was not READ draws no arrow'` and `'pendingTag — a macOS node draws no arrow (not centrally managed, decision 17)'`
- Run, not modified: `pwa/test/fleet-css.test.ts` (the `repeat(n, 1fr)` sweep), `pwa/test/contrast.test.ts` (no stale registry entry; every `why` longer than 20 characters), `node design/contrast-check.mjs`, `npm run build`; `server/test/single-definition.test.ts` (it walks `pwa/src`: W2 Task 1's SQL-tuple fingerprint and single-holder cases read the new code). NOT run for R13: no file this task edits is cited by `session-hook.test.ts`'s corpus (the compaction-card spec, its plan A, `README.md` — measured at `d759c914`: no `SettingsScreen.tsx:`, `useUpdatesView.ts:`, `fleet.css:` or `audit.mjs:` token in any of the three)

**Interfaces:**
- Consumes: `NodeWire` in full (W2 Task 1: `nodeId`, `label`, `role: NodeRole | null`, `os: NodeOs`, `current: BuildInfo | null`, `stampRead: StampRead`, `installState`, `provenance`, `measuredAt`, `reachable`, `unreachableSince`, `channel: UpdateChannel | null`, `desiredTag`, `resolveDetail`, `request: NodeRequestWire | null` (`{tag, kind, at}`), `report: NodeReportWire | null` (`{phase, target, startedAt, updatedAt, detail}`), `update: NodeUpdateWire` (`{state, target, startedAt, detail}`)); `ReleaseWire.refused: ReleaseRefusalWire[]` (`{by, at}`, `by` = nodeId); `isStampRead`, `isReleaseTag`, `isUpdateChannel`, `UpdateChannel`, `SETTLED_UPDATE_STATES` (W2 Task 1, `shared/api.ts`; the last is the lease-state set W2 Task 5's `ackNode` acks from — `WHERE updateState IN` settled, any other state answering `{ok: false, why: 'busy'}` and writing nothing, D-3183); Task 5's `pendingTag`, `nodeVersion` (`pwa/src/fleet/useUpdatesView.ts`), `api.ackUpdateNode(nodeId): Promise<AckAnswer | 'unreadable'>`, `updateErrorText`, `MOVE_DISABLED_TEXT`, `ApiError` (`pwa/src/lib/api.ts`); W2 Task 13's ack answers — `200 AckAnswer` · `400 bad-request {field}` · `404 unknown-node` · `409 superseded` / `busy {detail}` · `501`; Task 7's `UpdatesBody({ view, stale, now, reload })` — the module-private component the Updates section renders over a landed view, whose props are the screen's one `useUpdatesView()` poll (`view`, the last good `UpdatesView`, NON-NULL there, whose `nodes`/`releases` `asUpdatesView` guarantees are arrays; `reload`) and its one `useNow(30_000)` (`now`); Task 8's `ReleaseList` line inside `UpdatesBody` (placement anchor), `.settings-badge`/`.settings-badge--<channel>` and `.settings-move-note` rules, and the `.btn-ghost settings-move` button shape with its compound `.btn-ghost.settings-move` rule (`width: auto`); `elapsedWords` (`pwa/src/lib/elapsed.ts:28`); `toast` (`pwa/src/components/Toast.tsx:33`), `ToastHost` (`:45`, rendered by the toast tests — `pool-sheet.test.tsx:41-60`'s "mount the sole toast subscriber" idiom, queried with `{ selector: '.toast' }`); `useId`, `useState` (React 19); `declValue`, `ruleIn` (`pwa/test/cssRule.ts:98`, `:139`).
- Produces (exported from `SettingsScreen.tsx`):

```ts
/** Spec §13's sentence for a Darwin row, in place of its desired (decision 17). */
export const MACOS_UNMANAGED_TEXT = 'macOS: not centrally managed';
/** The info toast after an ack whose 200 carried a body that would not parse (postJsonOr's 'unreadable'). */
export const ACK_UNREADABLE_TEXT = "Acknowledged — the server's answer could not be read; the screen will re-check.";
/** What the current cell SAYS: 'not measured' while measuredAt is not a number; `stamp ${stampRead}` while the
 *  stamp was not read (an out-of-vocabulary word reads 'unreadable', W2's fallback); else nodeVersion(n), else
 *  'unversioned' — which therefore only ever means "a stamp was read and carries no tag". */
export function currentText(n: NodeWire): string;
/** amber iff measuredAt is not a number, stampRead !== 'ok', nodeVersion(n) === null (unversioned),
 *  provenance !== 'verified', or installState !== 'complete'. */
export function currentIsAmber(n: NodeWire): boolean;
/** false unless update.state is one of SETTLED_UPDATE_STATES (idle | reverted | failed) — a busy, absent or
 *  unnamed state is a row the ack route refuses `busy`, so it is never offered; then: update.state 'failed' |
 *  'reverted', OR a request outstanding (request is an object), OR some release's refused[] names this nodeId
 *  (a non-array refused and a malformed element read as none). */
export function canAck(n: NodeWire, releases: readonly ReleaseWire[]): boolean;
/** `${request.kind} ${request.tag} requested ${elapsedWords(now - request.at)} ago`, or null (none, or malformed). */
export function requestLine(n: NodeWire, now: number): string | null;
/** update.state ('unknown' when absent), then ` — ${report.phase}` when a report exists, then `: ${report.detail}`
 *  when it carries a non-empty one. */
export function nodeStateLine(n: NodeWire): string;
/** `unreachable since ${elapsedWords(now - unreachableSince)} ago` (or 'unreachable' with no since) iff
 *  reachable === false exactly; null otherwise — an absent field claims nothing. */
export function reachabilityLine(n: NodeWire, now: number): string | null;
```

- Produces (in `pwa/src/fleet/useUpdatesView.ts`, corrected): `pendingTag(n)` is null when `n.stampRead !== 'ok'` — the one arrow predicate now also requires the stamp to have been READ — and null when `n.os === 'darwin'` — no surface draws an arrow for a node this programme does not manage.
- **Five corrections to the skeleton's interface, each a tightening:**
  1. **`pendingTag` needs a read stamp** (D-3307). Task 5's predicate returns `desiredTag` whenever `nodeVersion(n)` is null — and `nodeVersion` is null both for an unversioned build (stamp read, no tag) AND for a stamp that could not be read, whose `current` W2's `toNodeWire` sets to NULL (`buildInfoOfRow` returns null for `stampRead ≠ ok`, W2 Task 11). W2's resolver still resolves such a node (`floorOf(highestVersion, null)` is unconstrained or the floor file's tag), so `desiredTag` and `channel` are set and the node would draw `→ v0.0.10` — contradicting spec §13's pin ("a node with `stampRead: 'unreadable'` renders amber and no arrow") and §18 "`stampRead` keeps EACCES from unversioned". The guard goes in the ONE predicate, not in this row, so the banner (Task 11) and BuildLine (Task 12) inherit it rather than disagree with the inventory. Every Task 5 case stays green: its fixtures carry `stampRead: 'ok'`.
  2. **The current cell is `currentText(n)`, not `nodeVersion(n) ?? 'unversioned'`.** The skeleton's rendering prints `unversioned` for a stamp the sweep could not read (EACCES) and for a label placeholder nobody measured — the exact fold §18 "`stampRead` keeps EACCES from unversioned" forbids, moved to the screen. `currentText` keeps the three words apart; `currentIsAmber` is unchanged in intent and gains the explicit `measuredAt` clause (a placeholder's `stampRead` is `unreadable`, so the verdict is the same on real rows; the clause makes an element with `measuredAt` absent amber too).
  3. **`reachabilityLine` is added.** `markUnreachable` keeps a node's LAST measured columns and sets `reachable = 0` (W2 Task 5), so an unreachable node's row would show a version and a settled state as if current — the reading spec §13's "unreachable is not current" names. The row says `unreachable since 5m ago` (the `FleetHostBanner` phrase, `FleetHostBanner.tsx:40-44`) when `reachable === false`.
  4. **A Darwin row renders no Update / Roll back** (D-3308); Ack stays, gated by `canAck` like every row. **And a Darwin node draws no arrow on ANY surface** (D-3309, found reviewing Task 11): the rule lives in `pendingTag` (`if (n.os === 'darwin') return null;`), not in `NodeItem` — the same argument as correction 1 — because W2's resolver resolves a Darwin node like any other (`os` plays no part in §9's resolution), so its `desiredTag`/`channel` can be set, and a row-only clause would leave the banner raising "Update all" and BuildLine drawing `server v0.0.9 → v0.0.10` for a node whose row says `macOS: not centrally managed`. `NodeItem` therefore reads `const next = pendingTag(n);` with no Darwin clause of its own; `darwin` still selects the macOS sentence and drops Update / Roll back. Only a MEASURED `darwin` is excluded: `os: 'unknown'` (a caps file that did not read) keeps its arrow, as `NodeItem`'s own `n.os === 'darwin'` test already reads it. The release push (Tasks 2–3) is untouched: it compares `currentVersion`, not `pendingTag`, so a macOS-only fleet still hears that a release is out.
  5. **Ack is offered only on a settled lease** (D-3310). The decomposition's rule enables Ack when `update.state ∈ {failed, reverted}` OR a request is outstanding OR the node has refusals, with no condition on the lease — but W2 Task 5's `ackNode` guards `AND updateState IN` `SETTLED_UPDATE_STATES` and answers `busy` for `pending`, `applying` and `unknown` (D-3183: an ack never kills a live lease). Under the unconditioned rule a `pending`/`applying` row carrying its request (every in-flight update once W4's `requestNode` writes requests) shows an ENABLED Ack whose every tap is the busy toast. `canAck` therefore returns false first unless `update.state` is in W2's `SETTLED_UPDATE_STATES` (imported, never a second list), then keeps the three positive clauses unchanged. The route stays the authority: a row the poll read settled and the route found busy (a race) still renders `updateErrorText`'s sentence. Cost if wrong: a wedged `unknown` row with a request shows no Ack until W4's deadline turns it `failed` — the same cost D-3183 already accepts on the store.
- A row renders, in order: `span.settings-node-label` `label` · `span.settings-node-detail` `${role ?? 'unknown role'} · ${os}` · in `p.settings-node-versions`: `span.settings-node-current` `currentText(n)` (plus `settings-node-current--amber` iff `currentIsAmber`), then the desired cell — `MACOS_UNMANAGED_TEXT` when `os === 'darwin'`; else, when `pendingTag(n)` is non-null, `span.settings-node-desired` `→ ${tag}` with Task 8's `span.settings-badge.settings-badge--<channel>`; else, when `desiredTag` is not a tag or `channel` is not a channel, `resolveDetail` as text (no badge, no arrow); else nothing (never an "up to date" word) · `reachabilityLine` · `requestLine` · `nodeStateLine` · in `div.settings-node-actions`: `Update` and `Roll back` (`button.btn-ghost.settings-move[disabled]`, both `aria-describedby` one `span.settings-move-note` holding `MOVE_DISABLED_TEXT`; absent on a Darwin row), then `Ack` — ENABLED iff `canAck` (and not while its own request is in flight), calling `api.ackUpdateNode(n.nodeId)`, toasting `ACK_UNREADABLE_TEXT` on `'unreadable'` and `updateErrorText(err)` (kind `error`) on a rejection, then `reload()` either way. `nodes: []` renders no list.
- Cases: `stampRead: 'unreadable'` renders amber `stamp unreadable` and no arrow; `channel: null` renders `resolveDetail` and no badge; `measuredAt: null` renders amber `not measured`, the reachability line and no arrow; a newer desired renders `→ v0.0.10` and the `stable` badge; a Darwin row renders the macOS sentence, no desired, no Update/Roll back, and an Ack; a `failed` node's Ack is enabled, sends `nodeId` and re-polls; an `idle` node with no request and no refusal has Ack disabled; a node named in `refused[]` has Ack enabled; a request renders its line and its state line (`pending — fetching`) and leaves Ack DISABLED on that `pending` row, while the same request on a settled (`idle`) row enables it; a `409 busy` on a row the poll read settled (a race) renders `updateErrorText`'s sentence in an error toast; an `'unreadable'` ack renders `ACK_UNREADABLE_TEXT`; a label and a `report.detail` carrying markup render as text; Update and Roll back are disabled with the sentence on every non-Darwin row; `role: null` reads `unknown role`; `pendingTag` null for `unreadable`/`malformed`/`absent`/missing `stampRead`, and still the desired tag for an unversioned stamp that was read; `pendingTag` null for `os: 'darwin'` with a newer desired on a resolved channel and a read stamp, and still the desired tag for `linux` and for `unknown`.
- Spec §18 rows pinned: "unreachable is not current" (the arrow half on this surface — mutation: bypass `pendingTag` with a bare `desiredTag` → red), "the move controls are disabled in W3" (mutation: drop `disabled` from Update → red); and the display half of W2's "`stampRead` keeps EACCES from unversioned" (mutations: drop `currentText`'s stamp line → red; drop `pendingTag`'s stamp guard → red in both files). Decision 17 in the predicate (mutation: drop `pendingTag`'s Darwin guard → red in `use-updates-view.test.tsx`, and in Tasks 11 and 12's macOS cases once they exist).

- [ ] **Step 1: Record the contrast audit's census before any edit**

Run: `cd pwa && node design/contrast-check.mjs | grep -E '^ALL [0-9]+ PASS$|rules set a colour with no ground'`
Expected: an `ALL <p> PASS` line and a `# <u> rules set a colour with no ground this auditor can recover …` line. Write both numbers down: `<u>` must be unchanged after Step 6 and `<p>` must rise by exactly 4 (the two registered rules, measured in two themes each). Measured on a copy of `pwa/` at `d759c914` with Task 8's CSS and entries applied and nothing of Tasks 6–7: `ALL 578 PASS` and `255`; on the branch the numbers are whatever Tasks 6–8 left, which is why this step measures rather than quotes.

- [ ] **Step 2: Write the failing tests**

(a) Merge these names into `pwa/test/settings-screen.test.tsx`'s existing import lines (Task 6 created the file; Tasks 7–8 extended it) — add each name only to the line for its module, and only if that line does not already import it; a duplicated name is a TypeScript error under `npm run build`, an unused one is `noUnusedLocals`:

```tsx
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BuildInfo } from '../../shared/buildinfo';
import type { NodeWire, ReleaseWire, UpdatesView } from '../../shared/api';
import { FLEET_SCOPE } from '../../shared/api';
import {
  ACK_UNREADABLE_TEXT, MACOS_UNMANAGED_TEXT, SettingsScreen, canAck, currentIsAmber, currentText,
  nodeStateLine, reachabilityLine, requestLine,
} from '../src/screens/SettingsScreen';
import { ToastHost } from '../src/components/Toast';
import { ApiError, MOVE_DISABLED_TEXT, api, updateErrorText } from '../src/lib/api';
import { declValue, ruleIn } from './cssRule';
```

Then APPEND after the file's last line. The fixtures are module-level with a `T9_`/`t9` prefix, Task 8's convention, so no name collides with Tasks 6–8's helpers; the file's own full `afterEach` (Task 6, `accounts-screen.test.tsx:46-51`'s four resets — `cleanup()` also unmounts the `ToastHost`) covers both describes.

```tsx
// ── Task 9: the node inventory (design 2026-09-20 §13, §18) ──────────────────
// Local fixtures on purpose, as Task 8's are: a shared module-level `node()`
// would couple four tasks' cases to one shape nobody owns.
const T9_T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const T9_NODE_A = '33333333-3333-4333-8333-333333333333';
const T9_NODE_B = '44444444-4444-4444-8444-444444444444';
const T9_MIN = 60_000;
/** A stamp at `version`; `undefined` = an unversioned (deploy.sh) build — the key is ABSENT, as the parser leaves it. */
const t9Stamp = (version: string | undefined): BuildInfo => ({
  sha: 'b'.repeat(40), ref: 'main', builtAt: '2026-09-23T12:00:00Z', dirty: false,
  ...(version === undefined ? {} : { version }),
});
/** A full NodeWire, every field W2 Task 1 declares: measured, reachable, verified, settled, and current. */
const t9Node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: T9_NODE_A, role: 'fleet', label: 'fleet', os: 'linux',
  current: t9Stamp('v0.0.9'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor', 'update-gate'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  measuredAt: T9_T0, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
const t9Server = (over: Partial<NodeWire> = {}): NodeWire =>
  t9Node({ nodeId: T9_NODE_B, role: 'server', label: 'server', agentOps: null, ...over });
const t9Release = (tag: string, over: Partial<ReleaseWire> = {}): ReleaseWire => ({
  tag, version: tag, channel: 'stable', publishedAt: T9_T0, commitSha: 'd'.repeat(40),
  bundleListed: true, yanked: false, refused: [], notes: null, ...over,
});
/** A label placeholder exactly as W2's markUnreachable writes one: keyed by its LABEL (no node-id file was ever
 *  read), never measured, stamp unreadable, unknowns, caps empty, agentOps null for a non-fleet role. */
const t9Placeholder = (over: Partial<NodeWire> = {}): NodeWire => t9Server({
  nodeId: 'server', measuredAt: null, current: null, stampRead: 'unreadable', installState: 'unknown', provenance: 'unknown',
  os: 'unknown', caps: [], highestVersion: null, reachable: false, unreachableSince: T9_T0, ...over,
});

describe('SettingsScreen — the node inventory: helpers', () => {
  it('currentText keeps "not measured", "stamp <word>" and "unversioned" apart (§18 "stampRead keeps EACCES from unversioned")', () => {
    expect(currentText(t9Node())).toBe('v0.0.9');
    expect(currentText(t9Node({ current: t9Stamp(undefined) })), 'read, no tag').toBe('unversioned');
    expect(currentText(t9Node({ stampRead: 'unreadable', current: null })), 'EACCES').toBe('stamp unreadable');
    expect(currentText(t9Node({ stampRead: 'malformed', current: null }))).toBe('stamp malformed');
    expect(currentText(t9Node({ stampRead: 'absent', current: null }))).toBe('stamp absent');
    expect(currentText(t9Node({ stampRead: 'later' as unknown as NodeWire['stampRead'], current: null })), 'an unnamed word')
      .toBe('stamp unreadable');
    expect(currentText(t9Placeholder()), 'a placeholder is not an unversioned node').toBe('not measured');
  });

  it('currentIsAmber: each condition alone turns the cell amber; a measured, verified, complete, tagged stamp does not', () => {
    expect(currentIsAmber(t9Node())).toBe(false);
    expect(currentIsAmber(t9Node({ current: t9Stamp(undefined) })), 'unversioned').toBe(true);
    expect(currentIsAmber(t9Node({ provenance: 'unverified' })), 'unverified').toBe(true);
    expect(currentIsAmber(t9Node({ provenance: 'unknown' })), 'provenance unknown').toBe(true);
    expect(currentIsAmber(t9Node({ installState: 'incomplete' })), 'incomplete').toBe(true);
    expect(currentIsAmber(t9Node({ stampRead: 'unreadable' })), 'stamp not read, tag still present').toBe(true);
    expect(currentIsAmber(t9Node({ measuredAt: null })), 'never measured').toBe(true);
  });

  it('canAck: on a settled lease only — then a halted state, an outstanding request or a refusal naming THIS node', () => {
    const settled = (state: NodeWire['update']['state']): NodeWire =>
      t9Node({ update: { state, target: null, startedAt: null, detail: null } });
    expect(canAck(settled('failed'), [])).toBe(true);
    expect(canAck(settled('reverted'), [])).toBe(true);
    for (const state of ['idle', 'pending', 'applying', 'unknown'] as const) {
      expect(canAck(settled(state), []), state).toBe(false);
    }
    const REQ = { tag: 'v0.0.10', kind: 'update', at: T9_T0 } as const;
    expect(canAck(t9Node({ request: REQ }), []), 'a request on an idle row').toBe(true);
    const refusedHere = t9Release('v0.0.10', { refused: [{ by: T9_NODE_A, at: T9_T0 }] });
    const refusedThere = t9Release('v0.0.10', { refused: [{ by: T9_NODE_B, at: T9_T0 }] });
    // A busy lease is never offered, whatever else the row carries: W2's ackNode answers `busy` there (D-3183).
    for (const state of ['pending', 'applying', 'unknown'] as const) {
      const busy = { state, target: 'v0.0.10', startedAt: T9_T0, detail: null };
      expect(canAck(t9Node({ update: busy, request: REQ }), []), `${state} with a request`).toBe(false);
      expect(canAck(t9Node({ update: busy }), [refusedHere]), `${state} with a refusal`).toBe(false);
    }
    const unnamed = { state: 'later', target: null, startedAt: null, detail: null } as unknown as NodeWire['update'];
    expect(canAck(t9Node({ update: unnamed, request: REQ }), []), 'an unnamed state').toBe(false);
    expect(canAck({ ...t9Node({ request: REQ }), update: undefined } as unknown as NodeWire, []), 'update absent').toBe(false);
    expect(canAck(t9Node(), [t9Release('v0.0.9'), refusedHere]), 'refused by this node').toBe(true);
    expect(canAck(t9Node(), [refusedThere]), 'refused by ANOTHER node').toBe(false);
    expect(canAck(t9Node(), [t9Release('v0.0.10', { refused: {} as unknown as ReleaseWire['refused'] })])).toBe(false);
    expect(canAck(t9Node(), [t9Release('v0.0.10', { refused: [null] as unknown as ReleaseWire['refused'] })])).toBe(false);
  });

  it('requestLine: kind, tag and age of an outstanding request; null with none or a malformed one', () => {
    expect(requestLine(t9Node(), T9_T0)).toBeNull();
    expect(requestLine(t9Node({ request: { tag: 'v0.0.10', kind: 'update', at: T9_T0 - 5 * T9_MIN } }), T9_T0))
      .toBe('update v0.0.10 requested 5m ago');
    expect(requestLine(t9Node({ request: { tag: 'v0.0.8', kind: 'rollback', at: T9_T0 } }), T9_T0))
      .toBe('rollback v0.0.8 requested moments ago');
    expect(requestLine(t9Node({ request: { tag: 'v0.0.8' } as unknown as NodeWire['request'] }), T9_T0)).toBeNull();
  });

  it("nodeStateLine: the lease state, then the report's phase, then its detail when it has one", () => {
    expect(nodeStateLine(t9Node())).toBe('idle');
    const report = { phase: 'fetching', target: 'v0.0.10', startedAt: T9_T0, updatedAt: T9_T0, detail: null } as const;
    expect(nodeStateLine(t9Node({
      update: { state: 'applying', target: 'v0.0.10', startedAt: T9_T0, detail: null }, report,
    }))).toBe('applying — fetching');
    expect(nodeStateLine(t9Node({
      update: { state: 'failed', target: 'v0.0.10', startedAt: T9_T0, detail: null },
      report: { ...report, phase: 'failed', detail: 'health check did not pass' },
    }))).toBe('failed — failed: health check did not pass');
    expect(nodeStateLine(t9Node({ report: { ...report, detail: '' } })), 'an empty detail adds nothing').toBe('idle — fetching');
    expect(nodeStateLine({ ...t9Node(), update: undefined } as unknown as NodeWire), 'update absent').toBe('unknown');
  });

  it('reachabilityLine: only reachable === false speaks; an absent field claims nothing', () => {
    expect(reachabilityLine(t9Node(), T9_T0)).toBeNull();
    expect(reachabilityLine(t9Node({ reachable: false, unreachableSince: T9_T0 - 5 * T9_MIN }), T9_T0))
      .toBe('unreachable since 5m ago');
    expect(reachabilityLine(t9Node({ reachable: false, unreachableSince: null }), T9_T0)).toBe('unreachable');
    expect(reachabilityLine({ ...t9Node(), reachable: undefined } as unknown as NodeWire, T9_T0)).toBeNull();
  });

  it("spells spec §13's Darwin sentence", () => {
    expect(MACOS_UNMANAGED_TEXT).toBe('macOS: not centrally managed');
  });
});

describe('SettingsScreen — the node inventory: rendering (design 2026-09-20 §13)', () => {
  const view = (nodes: NodeWire[], releases: ReleaseWire[] = [t9Release('v0.0.9')]): UpdatesView => ({
    catalogue: { lastOkAt: T9_T0, lastError: null },
    releases,
    nodes,
    intent: [{ scope: FLEET_SCOPE, channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel', setAt: T9_T0, setBy: 'test' }],
  });
  /** Render the screen (with the one toast subscriber) over one answer and return the inventory list — every case
   *  reads INSIDE it, because the release list (Task 8) renders the same tags on the same screen. */
  const renderNodes = async (nodes: NodeWire[], releases?: ReleaseWire[]) => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(view(nodes, releases));
    render(<><ToastHost /><SettingsScreen /></>);
    const list = await screen.findByRole('list', { name: 'Nodes' });
    return { list, updates };
  };
  const rowOf = (list: HTMLElement, nodeId: string): HTMLElement => {
    const row = list.querySelector<HTMLElement>(`li[data-node-id="${nodeId}"]`);
    if (row === null) throw new Error(`no inventory row for ${nodeId}`);
    return row;
  };

  it('renders label, role, os and a calm current, with no arrow and no "up to date" for a node on its desired tag', async () => {
    const { list } = await renderNodes([t9Node(), t9Server({ role: null })]);
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('data-node-id'))).toEqual([T9_NODE_A, T9_NODE_B]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText('fleet')).toHaveClass('settings-node-label');
    expect(within(row).getByText('fleet · linux')).toHaveClass('settings-node-detail');
    const current = within(row).getByText('v0.0.9');
    expect(current).toHaveClass('settings-node-current');
    expect(current).not.toHaveClass('settings-node-current--amber');
    expect(row.textContent).not.toContain('→');
    expect(row.textContent).not.toMatch(/up to date/i);
    expect(within(row).getByText('idle')).toBeInTheDocument();
    expect(within(rowOf(list, T9_NODE_B)).getByText('unknown role · linux')).toBeInTheDocument();
  });

  it('draws the arrow for a newer desired tag, with the channel badge', async () => {
    const { list } = await renderNodes([t9Node({ desiredTag: 'v0.0.10' })]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText('→ v0.0.10')).toHaveClass('settings-node-desired');
    expect(within(row).getByText('stable')).toHaveClass('settings-badge', 'settings-badge--stable');
  });

  it('an unreadable stamp renders amber and no arrow, even with a newer desired tag (§13 Pins)', async () => {
    const { list } = await renderNodes([
      t9Node({ stampRead: 'unreadable', current: null, provenance: 'unknown', desiredTag: 'v0.0.10' }),
    ]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText('stamp unreadable')).toHaveClass('settings-node-current--amber');
    expect(within(row).queryByText('unversioned')).toBeNull();
    expect(row.textContent).not.toContain('→');
    expect(row.querySelector('.settings-badge')).toBeNull();
  });

  it('a node with no resolved channel renders resolveDetail and no badge, no arrow (§13 Pins)', async () => {
    const WHY = 'a stored channel is one this build cannot read — nothing resolves';
    const { list } = await renderNodes([t9Node({ channel: null, desiredTag: null, resolveDetail: WHY })]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText(WHY)).toHaveClass('settings-node-detail');
    expect(row.querySelector('.settings-badge')).toBeNull();
    expect(row.textContent).not.toContain('→');
  });

  it('a node never measured reads "not measured" in amber, says it is unreachable, and draws no arrow (§18 "unreachable is not current")', async () => {
    const { list } = await renderNodes([
      t9Node(),
      t9Placeholder({ unreachableSince: Date.now() - 5 * T9_MIN, channel: 'stable', desiredTag: 'v0.0.10' }),
    ]);
    const row = rowOf(list, 'server');   // the placeholder's id is its label (W2 markUnreachable)
    expect(within(row).getByText('not measured')).toHaveClass('settings-node-current--amber');
    expect(within(row).getByText('unreachable since 5m ago')).toHaveClass('settings-node-detail');
    expect(within(row).queryByText('unversioned')).toBeNull();
    expect(row.textContent).not.toContain('→');
  });

  it('a Darwin row reads the macOS sentence in place of its desired, and offers no move', async () => {
    const { list } = await renderNodes([t9Node({ os: 'darwin', desiredTag: 'v0.0.10' })]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText(MACOS_UNMANAGED_TEXT)).toBeInTheDocument();
    expect(row.textContent).not.toContain('→');
    expect(within(row).queryByRole('button', { name: 'Update' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Roll back' })).toBeNull();
    expect(within(row).queryByText(MOVE_DISABLED_TEXT)).toBeNull();
    expect(within(row).getByRole('button', { name: 'Ack' })).toBeDisabled();   // idle, nothing to acknowledge
  });

  it('renders Update and Roll back DISABLED on every managed row, described by the one W3 sentence (§18 "the move controls are disabled in W3")', async () => {
    const { list } = await renderNodes([t9Node({ desiredTag: 'v0.0.10' }), t9Server()]);
    for (const id of [T9_NODE_A, T9_NODE_B]) {
      const row = rowOf(list, id);
      for (const name of ['Update', 'Roll back']) {
        const b = within(row).getByRole('button', { name });
        expect(b, `${id} ${name}`).toBeDisabled();
        expect(b).toHaveAccessibleDescription(MOVE_DISABLED_TEXT);
      }
      expect(within(row).getAllByText(MOVE_DISABLED_TEXT)).toHaveLength(1);
    }
  });

  it('an idle node with no request and no refusal has Ack disabled', async () => {
    const { list } = await renderNodes([t9Node()]);
    expect(within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Ack' })).toBeDisabled();
  });

  it("a failed node's Ack is enabled, sends its nodeId and re-polls the view", async () => {
    const failed = t9Node({ update: { state: 'failed', target: 'v0.0.10', startedAt: T9_T0, detail: null } });
    const ack = vi.spyOn(api, 'ackUpdateNode').mockResolvedValue({ ok: true, node: t9Node() });
    const { list, updates } = await renderNodes([failed]);
    const before = updates.mock.calls.length;
    const button = within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Ack' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledWith(T9_NODE_A);
    await waitFor(() => expect(updates.mock.calls.length).toBeGreaterThan(before));
  });

  it('a node named in refused[] has Ack enabled; a refusal naming another node does not enable it', async () => {
    const { list } = await renderNodes(
      [t9Node(), t9Server()],
      [t9Release('v0.0.10', { refused: [{ by: T9_NODE_B, at: T9_T0 }] })],
    );
    expect(within(rowOf(list, T9_NODE_B)).getByRole('button', { name: 'Ack' })).toBeEnabled();
    expect(within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Ack' })).toBeDisabled();
  });

  it('an outstanding request renders its line and the state with the report phase; Ack is offered only once the lease is settled', async () => {
    const request = { tag: 'v0.0.10', kind: 'update', at: Date.now() - 5 * T9_MIN } as const;
    const { list } = await renderNodes([
      t9Node({
        desiredTag: 'v0.0.10', request,
        update: { state: 'pending', target: 'v0.0.10', startedAt: T9_T0, detail: null },
        report: { phase: 'fetching', target: 'v0.0.10', startedAt: T9_T0, updatedAt: T9_T0, detail: null },
      }),
      t9Server({ request }),   // the same request on an idle row
    ]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText('update v0.0.10 requested 5m ago')).toHaveClass('settings-node-detail');
    expect(within(row).getByText('pending — fetching')).toHaveClass('settings-node-detail');
    // pending is busy: W2's ackNode would answer `busy`, so the control is not offered (D-3183)
    expect(within(row).getByRole('button', { name: 'Ack' })).toBeDisabled();
    expect(within(rowOf(list, T9_NODE_B)).getByRole('button', { name: 'Ack' })).toBeEnabled();
  });

  it("a refused ack is the route's sentence in an error toast — the route stays the authority", async () => {
    // A race: the poll read the row idle with its request, and by the tap the route found it busy.
    const busy = new ApiError(409, { ok: false, error: 'busy', detail: 'applying' });
    vi.spyOn(api, 'ackUpdateNode').mockRejectedValue(busy);
    const { list } = await renderNodes([t9Node({ request: { tag: 'v0.0.10', kind: 'update', at: T9_T0 } })]);
    const button = within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Ack' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    const t = await screen.findByText(updateErrorText(busy), { selector: '.toast' });
    expect(t).toHaveClass('toast--error');
  });

  it('an ack whose answer could not be read says so, and does not claim failure', async () => {
    vi.spyOn(api, 'ackUpdateNode').mockResolvedValue('unreadable');
    const { list } = await renderNodes([t9Node({ update: { state: 'reverted', target: null, startedAt: null, detail: null } })]);
    fireEvent.click(within(rowOf(list, T9_NODE_A)).getByRole('button', { name: 'Ack' }));
    const t = await screen.findByText(ACK_UNREADABLE_TEXT, { selector: '.toast' });
    expect(t).not.toHaveClass('toast--error');
  });

  it('renders a label and a report.detail carrying markup as literal text', async () => {
    const LABEL = '<img src=x onerror=alert(1)>box';
    const DETAIL = '<b>health</b> check failed — see https://example.com/x';
    const { list } = await renderNodes([t9Node({
      label: LABEL,
      update: { state: 'failed', target: 'v0.0.10', startedAt: T9_T0, detail: null },
      report: { phase: 'failed', target: 'v0.0.10', startedAt: T9_T0, updatedAt: T9_T0, detail: DETAIL },
    })]);
    const row = rowOf(list, T9_NODE_A);
    expect(within(row).getByText(LABEL)).toHaveClass('settings-node-label');
    expect(within(row).getByText(`failed — failed: ${DETAIL}`)).toBeInTheDocument();
    expect(row.querySelector('img, b, a, script')).toBeNull();
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('renders no inventory list for an empty nodes array', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(view([]));
    render(<SettingsScreen />);
    await screen.findByText(/^checked /);   // Task 7's catalogue line: the view has landed
    expect(screen.queryByRole('list', { name: 'Nodes' })).toBeNull();
  });

  it('keeps the amber ink and lets a long label wrap (css:false — read off fleet.css)', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
    expect(declValue(ruleIn(css, '.settings-node-current--amber'), 'color')).toBe('var(--status-attention-text)');
    expect(declValue(ruleIn(css, '.settings-node-label'), 'overflow-wrap')).toBe('anywhere');
    // The row's three buttons carry Task 8's pair; its compound rule is what keeps them inline.
    expect(declValue(ruleIn(css, '.btn-ghost.settings-move'), 'width')).toBe('auto');
  });
});
```

(b) APPEND after the last line of `pwa/test/use-updates-view.test.tsx` (its module-level `node()` fixture and its `NodeWire`/`pendingTag` imports are Task 5's; nothing is added to its import lines):

```tsx
// Task 9 (D-3307): a stamp the sweep could not READ is
// an unmeasured current, not an unversioned one — W2's toNodeWire sets
// `current` to null for it, and nodeVersion alone cannot tell the two apart.
describe('pendingTag — a stamp that was not READ draws no arrow', () => {
  it('reads unreadable, malformed, absent and a missing stampRead as "no arrow", never as unversioned', () => {
    for (const stampRead of ['unreadable', 'malformed', 'absent'] as const) {
      expect(pendingTag(node({ stampRead, current: null, desiredTag: 'v0.0.10' })), stampRead).toBeNull();
    }
    const missing = { ...node({ current: null, desiredTag: 'v0.0.10' }), stampRead: undefined } as unknown as NodeWire;
    expect(pendingTag(missing), 'stampRead absent from the element').toBeNull();
  });

  it('the control: an unversioned stamp that WAS read still points at its desired tag', () => {
    const { version: _v, ...untagged } = node().current!;
    void _v;
    expect(pendingTag(node({ current: untagged, desiredTag: 'v0.0.10' }))).toBe('v0.0.10');
  });
});

// Task 9 (D-3309): a macOS node is not centrally managed
// (decision 17), and W2's resolver resolves it like any other, so its desired
// tag can be set. The rule lives HERE, in the one arrow predicate, so the
// inventory row, the update banner and BuildLine cannot disagree about it.
describe('pendingTag — a macOS node draws no arrow (not centrally managed, decision 17)', () => {
  it('answers null for os darwin with a newer desired tag, a resolved channel and a read stamp', () => {
    expect(pendingTag(node({ os: 'darwin', desiredTag: 'v0.0.10' }))).toBeNull();
  });

  it('the control: the same node on linux, and on an os the caps file did not name, still points up', () => {
    expect(pendingTag(node({ desiredTag: 'v0.0.10' }))).toBe('v0.0.10');
    expect(pendingTag(node({ os: 'unknown', desiredTag: 'v0.0.10' }))).toBe('v0.0.10');
  });
});
```

- [ ] **Step 3: Run the new cases to verify they fail**

Run: `cd pwa && ./node_modules/.bin/vitest run test/settings-screen.test.tsx -t 'the node inventory'` (foreground; `npm ci` first if `pwa/node_modules` is absent)
Expected: FAIL. The six helper cases fail with a `TypeError` naming the missing export (`currentText is not a function`, and the same for `currentIsAmber`, `canAck`, `requestLine`, `nodeStateLine`, `reachabilityLine`); the Darwin-sentence case fails `expected undefined to be 'macOS: not centrally managed'`; every rendering case that awaits the list times out in `findByRole` with `Unable to find role="list" and name "Nodes"`; the "no inventory list" case PASSES already (nothing renders a list yet — its teeth are Step 8's mutation 10); the CSS case fails with `no rule for .settings-node-current--amber`. Every Task 6–8 case in the file stays green: `./node_modules/.bin/vitest run test/settings-screen.test.tsx` shows no failure outside the two new describes.

Run: `cd pwa && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx -t 'was not READ'`
Expected: FAIL — `unreadable: expected 'v0.0.10' to be null` in the first case; the control case PASSES (it pins the existing unversioned arm, so the guard cannot be written as "no arrow when current is null").

Run: `cd pwa && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx -t 'macOS node draws no arrow'`
Expected: FAIL — `expected 'v0.0.10' to be null` in the first case; the control case PASSES (it pins that the guard names `darwin` alone, so it cannot be written as "no arrow unless os is linux").

- [ ] **Step 4: Correct the one arrow predicate in `pwa/src/fleet/useUpdatesView.ts`**

In `pendingTag`, directly after the line `  if (!isUpdateChannel(n.channel)) return null;`, insert the two lines:

```ts
  if (n.stampRead !== 'ok') return null;
  if (n.os === 'darwin') return null;
```

In `pendingTag`'s docstring, replace the line ` * nothing comparable (unversioned) points at its desired tag.` with:

```ts
 * nothing comparable (unversioned) points at its desired tag — but only when its
 * stamp was READ: `stampRead` other than `ok` (EACCES, malformed, absent) is an
 * unmeasured current, which W2 also reports as a null `current`, and draws no
 * arrow (spec §13 Pins; §18 "`stampRead` keeps EACCES from unversioned";
 * D-3307). No arrow for a macOS node either: this
 * programme does not manage one (decision 17), and its row says so in place of
 * a desired — the rule is here, not in that row, so the banner and BuildLine
 * say the same (`os: 'unknown'` is not Darwin; D-3309).
```

Run: `cd pwa && ./node_modules/.bin/vitest run test/use-updates-view.test.tsx`
Expected: PASS — every Task 5 case (its fixtures carry `stampRead: 'ok'` and `os: 'linux'`) and the four new ones.

- [ ] **Step 5: Implement the inventory in `pwa/src/screens/SettingsScreen.tsx`**

Merge the imports into the lines Tasks 6–8 wrote (one name per module line, never a second line for a module already imported):
- `'react'` — nothing to add: Task 7's `import { useId, useState } from 'react';` already carries both hooks this task calls, and Task 6's `import type { ReactNode } from 'react';` the type;
- the `import type { … } from '../../../shared/api'` line — `NodeWire`, `ReleaseWire` (Tasks 7–8) and `UpdateChannel` (Task 7) are already there; add any that is not;
- the value import from `'../../../shared/api'` — add `isStampRead` and `SETTLED_UPDATE_STATES` (Task 8 added `isReleaseTag`, `isUpdateChannel`);
- the `'../lib/api'` import — `api`, `updateErrorText` (Task 7) and `MOVE_DISABLED_TEXT` (Task 8) are already there;
- the `'../fleet/useUpdatesView'` import — add `pendingTag` (Task 8 added `nodeVersion`);
- `toast` from `'../components/Toast'` and `elapsedWords` from `'../lib/elapsed'` are Task 7's.

Insert after Task 8's `function ReleaseList(…) { … }` and before `export function SettingsScreen`:

```tsx
// ── The node inventory (spec §13; programme wave 3 Task 9) ───────────────────
// One row per LIVE node (W2 excludes superseded rows), in the server's order.
// The rules this block keeps, each pinned in settings-screen.test.tsx:
//   * THE ARROW IS pendingTag's. A desired tag renders as `→ vX` only when
//     pendingTag (fleet/useUpdatesView.ts) returns it — measured, on a resolved
//     channel, with a stamp that was READ, not macOS, and newer by semver. This
//     row adds no clause of its own, so it cannot disagree with the banner or
//     BuildLine, which read the same predicate. When the node
//     has no desired tag or no channel, the resolver's own sentence
//     (resolveDetail) stands in: no badge, no arrow (§13). Nothing here says
//     "up to date": a node on its desired tag simply shows no desired.
//   * CURRENT SAYS WHAT WAS MEASURED. A node never measured reads `not
//     measured`, a stamp the sweep could not read reads `stamp <word>`, and
//     only a stamp that was read and carries no tag reads `unversioned` —
//     §18 "`stampRead` keeps EACCES from unversioned", on the screen. Anything
//     the row cannot vouch for is amber, and an unreachable node says so,
//     because W2 keeps its last measurement.
//   * TEXT IS TEXT. label, resolveDetail and report.detail are same-user-
//     writable; each reaches the DOM as a React text child and nothing else.
//   * macOS IS NOT MANAGED (decision 17). A Darwin row says so in place of its
//     desired and offers no move (D-3308); its arrow is
//     already null in pendingTag (D-3309).
// Update and Roll back are rendered DISABLED beside MOVE_DISABLED_TEXT (their
// routes are programme wave 5's). Ack is live — its route is W2's — and is
// offered only on a SETTLED lease, because W2's ackNode acks from nothing
// else (D-3183; D-3310). The route stays the
// authority: a row that went busy between the poll and the tap comes back as
// a 409 `busy`, rendered as updateErrorText's sentence, and the view is
// re-polled either way.

export const MACOS_UNMANAGED_TEXT = 'macOS: not centrally managed';
export const ACK_UNREADABLE_TEXT = "Acknowledged — the server's answer could not be read; the screen will re-check.";

export function currentText(n: NodeWire): string {
  if (typeof n.measuredAt !== 'number') return 'not measured';
  if (n.stampRead !== 'ok') return `stamp ${isStampRead(n.stampRead) ? n.stampRead : 'unreadable'}`;
  return nodeVersion(n) ?? 'unversioned';
}

export function currentIsAmber(n: NodeWire): boolean {
  return typeof n.measuredAt !== 'number'
    || n.stampRead !== 'ok'
    || nodeVersion(n) === null
    || n.provenance !== 'verified'
    || n.installState !== 'complete';
}

export function canAck(n: NodeWire, releases: readonly ReleaseWire[]): boolean {
  const state = n.update?.state;
  // A busy lease (pending, applying, unknown), an absent state or a word this build cannot name: ackNode answers busy.
  if (typeof state !== 'string' || !(SETTLED_UPDATE_STATES as readonly string[]).includes(state)) return false;
  if (state === 'failed' || state === 'reverted') return true;
  if (typeof n.request === 'object' && n.request !== null) return true;
  return releases.some((r) => Array.isArray(r.refused) && r.refused.some((x: unknown) =>
    typeof x === 'object' && x !== null && (x as { by?: unknown }).by === n.nodeId));
}

export function requestLine(n: NodeWire, now: number): string | null {
  const q: unknown = n.request;
  if (typeof q !== 'object' || q === null) return null;
  const { tag, kind, at } = q as { tag?: unknown; kind?: unknown; at?: unknown };
  if (typeof tag !== 'string' || typeof kind !== 'string' || typeof at !== 'number') return null;
  return `${kind} ${tag} requested ${elapsedWords(now - at)} ago`;
}

export function nodeStateLine(n: NodeWire): string {
  const state = typeof n.update?.state === 'string' ? n.update.state : 'unknown';
  const r: unknown = n.report;
  if (typeof r !== 'object' || r === null) return state;
  const { phase, detail } = r as { phase?: unknown; detail?: unknown };
  if (typeof phase !== 'string') return state;
  return typeof detail === 'string' && detail !== '' ? `${state} — ${phase}: ${detail}` : `${state} — ${phase}`;
}

export function reachabilityLine(n: NodeWire, now: number): string | null {
  if (n.reachable !== false) return null;
  return typeof n.unreachableSince === 'number'
    ? `unreachable since ${elapsedWords(now - n.unreachableSince)} ago`
    : 'unreachable';
}

function NodeItem({ node: n, releases, now, onAcked }: {
  node: NodeWire; releases: readonly ReleaseWire[]; now: number; onAcked: () => void;
}): ReactNode {
  const noteId = useId();
  const [acking, setAcking] = useState(false);
  const darwin = n.os === 'darwin';
  const next = pendingTag(n);   // null for a Darwin node too — the predicate's own guard
  const reach = reachabilityLine(n, now);
  const request = requestLine(n, now);
  const ackable = canAck(n, releases);

  const ack = (): void => {
    setAcking(true);
    void api.ackUpdateNode(n.nodeId).then(
      (answer) => { if (answer === 'unreadable') toast(ACK_UNREADABLE_TEXT); },
      (err: unknown) => { toast(updateErrorText(err), 'error'); },
    ).finally(() => {
      setAcking(false);
      onAcked();
    });
  };

  let desired: ReactNode = null;
  if (darwin) {
    desired = <span className="settings-node-detail">{MACOS_UNMANAGED_TEXT}</span>;
  } else if (next !== null) {
    // pendingTag returns a tag only for a node whose channel passed
    // isUpdateChannel; restating that test here would be a SECOND arrow
    // predicate, so the type is asserted, not re-derived (Task 11's argument).
    const channel = n.channel as UpdateChannel;
    desired = (
      <span className="settings-node-desired">
        {`→ ${next}`}
        <span className={`settings-badge settings-badge--${channel}`}>{channel}</span>
      </span>
    );
  } else if (!isReleaseTag(n.desiredTag) || !isUpdateChannel(n.channel)) {
    desired = typeof n.resolveDetail === 'string' && n.resolveDetail !== ''
      ? <span className="settings-node-detail">{n.resolveDetail}</span>
      : null;
  }

  return (
    <li className="settings-node" data-node-id={n.nodeId}>
      <div className="settings-node-head">
        <span className="settings-node-label">{n.label}</span>
        <span className="settings-node-detail">{`${n.role ?? 'unknown role'} · ${typeof n.os === 'string' ? n.os : 'unknown'}`}</span>
      </div>
      <p className="settings-node-versions">
        <span className={currentIsAmber(n) ? 'settings-node-current settings-node-current--amber' : 'settings-node-current'}>
          {currentText(n)}
        </span>
        {desired}
      </p>
      {reach !== null && <p className="settings-node-detail">{reach}</p>}
      {request !== null && <p className="settings-node-detail">{request}</p>}
      <p className="settings-node-detail">{nodeStateLine(n)}</p>
      <div className="settings-node-actions">
        {!darwin && (
          <>
            <button type="button" className="btn-ghost settings-move" disabled aria-describedby={noteId}>Update</button>
            <button type="button" className="btn-ghost settings-move" disabled aria-describedby={noteId}>Roll back</button>
            <span id={noteId} className="settings-move-note">{MOVE_DISABLED_TEXT}</span>
          </>
        )}
        <button type="button" className="btn-ghost settings-move" disabled={!ackable || acking} onClick={ack}>Ack</button>
      </div>
    </li>
  );
}

function NodeList({ nodes, releases, now, onAcked }: {
  nodes: readonly NodeWire[]; releases: readonly ReleaseWire[]; now: number; onAcked: () => void;
}): ReactNode {
  if (nodes.length === 0) return null;
  return (
    <ul className="settings-nodes" aria-label="Nodes">
      {nodes.map((n) => <NodeItem key={n.nodeId} node={n} releases={releases} now={now} onAcked={onAcked} />)}
    </ul>
  );
}
```

Then, inside Task 7's `UpdatesBody` (at the end of the file, after `export function SettingsScreen`), add ONE line directly after Task 8's `{view !== null && <ReleaseList releases={view.releases} nodes={view.nodes} />}` — `view`, `now` and `reload` are `UpdatesBody`'s own props (Task 7: the screen's one `useUpdatesView()` poll and its one `useNow(30_000)`, handed down through `UpdatesSection`); this task adds no second `useUpdatesView` or `useNow` call. `view` is non-null there, so the guard is Task 8's harmless restatement, kept so the two lines read alike:

```tsx
        {view !== null && <NodeList nodes={view.nodes} releases={view.releases} now={now} onAcked={reload} />}
```

`nodes.nodeId` is the table's primary key and W2's `nodes()` returns live rows only, so `key={n.nodeId}` is unique. The list is not re-sorted: W2's `ORDER BY label, nodeId` is the inventory's order, and the screen has no ordering rule of its own to disagree with it.

- [ ] **Step 6: Append the CSS and register the two inherited grounds**

Append to `pwa/src/fleet/fleet.css`, after its last line:

```css

/* — centralised update management W3, Task 9: the node inventory —
   One row per live node, in the server's order (label, then nodeId). Same
   unfilled row as the release list above it — a hairline, no fill — so the
   two rules that set `color` without a `background` (the amber current and
   the muted detail lines) are registered in design/audit.mjs's
   INHERITED_GROUNDS against --bg-page, the .settings-release-date argument.
   The desired cell reuses the release list's self-grounded channel badges
   and the move row reuses its .settings-move-note, both already measured. */
.settings-nodes { list-style: none; margin: 0; padding: 0; display: grid; }
.settings-node {
  display: grid;
  gap: var(--sp-1);
  min-width: 0;
  padding: var(--sp-2) 0;
  border-top: 1px solid var(--edge-subtle);
}
.settings-node-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2); min-width: 0; }
/* A label is same-user-writable text: it may be long and unbroken. */
.settings-node-label { font: var(--weight-medium) var(--text-sm) / var(--leading-tight) var(--font-ui); overflow-wrap: anywhere; }
.settings-node-versions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  margin: 0;
  font: var(--weight-regular) var(--text-sm) / var(--leading-tight) var(--font-mono);
}
.settings-node-current { font-variant-numeric: tabular-nums; }
/* Amber for a current the row cannot vouch for — unversioned, unverified,
   incomplete, a stamp that could not be read, or a node never measured. The
   same ink .build-line-side--warn uses for the same meaning. */
.settings-node-current--amber { color: var(--status-attention-text); }
.settings-node-desired { display: inline-flex; align-items: center; gap: var(--sp-1); }
.settings-node-detail { margin: 0; font-size: var(--text-xs); color: var(--ink-tertiary); overflow-wrap: anywhere; }
/* The three node buttons carry the `btn-ghost settings-move` pair: .btn-ghost
   (primitives.css) supplies the tap floor, the border and the disabled ink,
   and Task 8's compound .btn-ghost.settings-move already stops it filling the
   row — so no second override is written here. */
.settings-node-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
```

In `pwa/design/audit.mjs`, directly before `INHERITED_GROUNDS`' closing `};` (after Task 8's `'fleet.css .settings-move-note'` entry):

```js
  // ── centralised update management W3, Task 9: the node inventory ───────
  'fleet.css .settings-node-current--amber': {
    under: ['var(--bg-page)'],
    why: "the amber current-version cell of a SettingsScreen inventory row (unversioned, unverified, incomplete, stamp not read, never measured). .settings-node draws a hairline and no fill, .settings-section/.settings-screen and .shell-detail paint no background, so body's --bg-page (styles/base.css:111) is behind it — the .settings-release-date reasoning. Its selector names no painted ancestor",
  },
  'fleet.css .settings-node-detail': {
    under: ['var(--bg-page)'],
    why: "the muted role/os, desired-resolution, request, reachability and state lines of the same unfilled inventory row, in --ink-tertiary. Same ground and same reason as .settings-node-current--amber; registered separately because it sets its own colour",
  },
```

Run: `cd pwa && node design/contrast-check.mjs | grep -E '^ALL [0-9]+ PASS$|rules set a colour with no ground|settings-node'`
Expected: `ALL <p+4> PASS` (Step 1's `<p>` plus 4), the uncovered line still reading Step 1's `<u>`, and four `PASS` rows — measured on a copy of `pwa/` at `d759c914` with Task 8's and this task's CSS: `.settings-node-current--amber` `10.89 DARK` / `5.45 LIGHT` (`var(--status-attention-text) on var(--bg-page)`), `.settings-node-detail` `6.23 DARK` / `5.25 LIGHT` (`var(--ink-tertiary) on var(--bg-page)`). Then `node design/contrast-check.mjs --uncovered | grep -E '^#   fleet\.css \.settings-node'` prints nothing (no census line for this task's rules).

- [ ] **Step 7: Run green**

Run, one at a time, foreground, from `pwa/`:
`./node_modules/.bin/vitest run test/settings-screen.test.tsx` → PASS, every case (the 23 new ones — seven helper cases, sixteen rendering cases — and every Task 6–8 case)
`./node_modules/.bin/vitest run test/use-updates-view.test.tsx` → PASS (Task 5's cases and the four new ones — two in each appended describe)
`./node_modules/.bin/vitest run test/fleet-css.test.ts test/contrast.test.ts` → PASS (`contrast.test.ts`'s "has no stale inherited registry entry" and "gives a reason for every rule it exempts or hand-grounds" read the two new entries)
`node design/contrast-check.mjs` → exit 0, `ALL <p+4> PASS`
`npm run build` → `tsc --noEmit` clean, then the Vite build (a duplicated or unused import from Step 5's merge fails here, not in vitest, which strips types)
Then from `server/`: `./node_modules/.bin/vitest run test/single-definition.test.ts` → PASS (it walks `pwa/src`; the new code spells no parenthesised list of two or more quoted `UpdateState`/`StampRead`/… members — `canAck` compares one word at a time and reads settledness from W2's imported `SETTLED_UPDATE_STATES` — and declares none of W2's type names)

- [ ] **Step 8: Mutation measurement (spec §18 rows "unreachable is not current", "the move controls are disabled in W3", and the display half of "`stampRead` keeps EACCES from unversioned")**

Each mutation is one hand edit, the named case run red, then the edit reversed by hand (never `git checkout --`, which would discard this task's uncommitted work) and the restore confirmed by `grep -c` on the original text printing `1` (the greps below name repo-root paths — run them from the repo root). Run each settings mutation with `cd pwa && ./node_modules/.bin/vitest run test/settings-screen.test.tsx -t 'the node inventory'` unless the mutation says otherwise.

1. §18 "unreachable is not current" (the arrow, this surface) — in `NodeItem` (`pwa/src/screens/SettingsScreen.tsx`) change `const next = pendingTag(n);` to `const next = (isReleaseTag(n.desiredTag) ? n.desiredTag : null);` (the trailing comment stays) → RED: `a node never measured reads "not measured" in amber …` and `an unreadable stamp renders amber and no arrow …` (each finds `→`), and `renders label, role, os and a calm current …` (`→ v0.0.9` on a node already at its desired tag). Reverse; `grep -c 'const next = pendingTag(n);' pwa/src/screens/SettingsScreen.tsx` → `1`.
2. D-3307 — in `pendingTag` (`pwa/src/fleet/useUpdatesView.ts`) delete the line `  if (n.stampRead !== 'ok') return null;` → RED: `test/use-updates-view.test.tsx -t 'was not READ'` (`unreadable: expected 'v0.0.10' to be null`) and, in the settings file, `an unreadable stamp renders amber and no arrow …`. Reverse; `grep -c "  if (n.stampRead !== 'ok') return null;" pwa/src/fleet/useUpdatesView.ts` → `1`.
3. §18 "`stampRead` keeps EACCES from unversioned" (the display) — in `currentText` delete the line ``  if (n.stampRead !== 'ok') return `stamp ${isStampRead(n.stampRead) ? n.stampRead : 'unreadable'}`;`` → RED: `currentText keeps "not measured", "stamp <word>" and "unversioned" apart …` (`expected 'unversioned' to be 'stamp unreadable'`) and `an unreadable stamp renders amber and no arrow …` (no `stamp unreadable` text). Reverse; `` grep -c 'return `stamp ${isStampRead(n.stampRead)' pwa/src/screens/SettingsScreen.tsx `` → `1`. Then delete the line `  if (typeof n.measuredAt !== 'number') return 'not measured';` → RED: the same helper case (`expected 'stamp unreadable' to be 'not measured'`) and `a node never measured …`. Reverse; `grep -c "return 'not measured';" pwa/src/screens/SettingsScreen.tsx` → `1`.
4. §18 "the move controls are disabled in W3" — delete ` disabled` from `className="btn-ghost settings-move" disabled aria-describedby={noteId}>Update</button>` → RED: `renders Update and Roll back DISABLED on every managed row …` (`toBeDisabled` fails on `Update`). Reverse; `grep -c 'disabled aria-describedby={noteId}>Update</button>' pwa/src/screens/SettingsScreen.tsx` → `1`.
5. `canAck`'s halted states — change `if (state === 'failed' || state === 'reverted') return true;` to `if (state === 'failed') return true;` → RED: `canAck: a halted state, …` and `an ack whose answer could not be read …` (its `reverted` row's Ack is disabled, so the click sends nothing and no toast appears). Reverse; `grep -c "if (state === 'failed' || state === 'reverted') return true;" pwa/src/screens/SettingsScreen.tsx` → `1`.
6. `canAck`'s refusal clause — change `(x as { by?: unknown }).by === n.nodeId));` to `(x as { by?: unknown }).by === null));` → RED: `canAck: …` (`refused by this node`) and `a node named in refused[] has Ack enabled …`. Reverse; `grep -c '(x as { by?: unknown }).by === n.nodeId));' pwa/src/screens/SettingsScreen.tsx` → `1`.
7. Ack is gated — change `disabled={!ackable || acking} onClick={ack}` to `disabled={acking} onClick={ack}` → RED: `an idle node with no request and no refusal has Ack disabled`, the Darwin case's last assertion, `a node named in refused[] …` (the unnamed node's Ack), and `an outstanding request renders its line …` (the `pending` row's Ack). Reverse; `grep -c 'disabled={!ackable || acking} onClick={ack}' pwa/src/screens/SettingsScreen.tsx` → `1`.
8. The Darwin row — change `const darwin = n.os === 'darwin';` to `const darwin = false;` → RED: `a Darwin row reads the macOS sentence …` (no sentence, and an `Update` button appears; no `→ v0.0.10` appears, because `pendingTag`'s own Darwin guard still withholds it — mutation 13 measures that guard). Reverse; `grep -c "const darwin = n.os === 'darwin';" pwa/src/screens/SettingsScreen.tsx` → `1`.
9. The amber verdict — delete the line `    || n.provenance !== 'verified'` → RED: `currentIsAmber: each condition alone …` at `unverified`. Reverse; `grep -c "    || n.provenance !== 'verified'" pwa/src/screens/SettingsScreen.tsx` → `1`.
10. The empty-list control (the "no inventory list" case was green in Step 3, so its teeth are measured here) — in `NodeList` delete the line `  if (nodes.length === 0) return null;` → RED: `renders no inventory list for an empty nodes array` (an empty `ul` named `Nodes` renders). Reverse; `grep -c '  if (nodes.length === 0) return null;' pwa/src/screens/SettingsScreen.tsx` → `1`.
11. Text is text — replace `<span className="settings-node-label">{n.label}</span>` with `<span className="settings-node-label" dangerouslySetInnerHTML={{ __html: n.label }} />` → RED: `renders a label and a report.detail carrying markup as literal text` (an `img` appears in the row and `getByText(LABEL)` finds nothing); and, run WITHOUT the `-t` filter (which selects this task's describes only), Task 8's `spells no raw-HTML path anywhere in the screen …` too. Reverse; `grep -c '<span className="settings-node-label">{n.label}</span>' pwa/src/screens/SettingsScreen.tsx` → `1`, and `grep -c dangerouslySetInnerHTML pwa/src/screens/SettingsScreen.tsx` → `0`.
12. D-3310 — in `canAck` delete the line `  if (typeof state !== 'string' || !(SETTLED_UPDATE_STATES as readonly string[]).includes(state)) return false;` → RED: `canAck: on a settled lease only …` (`pending with a request: expected true to be false`) and `an outstanding request renders its line …` (the `pending` row's Ack is enabled); every other case stays green (the `SETTLED_UPDATE_STATES` import the deletion leaves unused would fail only `npm run build`'s `noUnusedLocals`, which a mutation run does not invoke — vitest strips types). Reverse; `grep -c '.includes(state)) return false;' pwa/src/screens/SettingsScreen.tsx` → `1`.
13. D-3309 — in `pendingTag` (`pwa/src/fleet/useUpdatesView.ts`) delete the line `  if (n.os === 'darwin') return null;` → RED: `test/use-updates-view.test.tsx -t 'macOS node draws no arrow'` (`expected 'v0.0.10' to be null`). The settings file's Darwin case stays GREEN, by design: `NodeItem` renders the macOS sentence before it looks at `next`, so the row alone cannot see the guard — the banner and BuildLine can, and Tasks 11 and 12 each re-measure this mutation on their own macOS case. Reverse; `grep -c "  if (n.os === 'darwin') return null;" pwa/src/fleet/useUpdatesView.ts` → `1`.

After the last reversal, `./node_modules/.bin/vitest run test/settings-screen.test.tsx test/use-updates-view.test.tsx` is green again with the Step 7 counts, and `git diff --stat` lists only the six files this task edits.

- [ ] **Step 9: Commit**

```bash
git add pwa/src/screens/SettingsScreen.tsx pwa/src/fleet/useUpdatesView.ts pwa/src/fleet/fleet.css pwa/design/audit.mjs pwa/test/settings-screen.test.tsx pwa/test/use-updates-view.test.tsx
git commit -m "feat(update): the node inventory on /settings — current says what was measured, the arrow only from pendingTag (which now needs a read stamp), macOS rows unmanaged, Update/Roll back disabled until W4, Ack live"
```

### Task 10: SettingsScreen — Notifications + the unarmed banner

**Files:**
- Modify: `pwa/src/screens/SettingsScreen.tsx` — three exported names (`NOTIFY_LABELS`, `UNARMED_EXPOSURE_TEXT`, `unarmedExposure`) and two module-private components (`UnarmedExposureBanner`, `NotificationsSection`) placed after Task 9's `function NodeList(…) { … }` (the last declaration Tasks 7–9 left above `export function SettingsScreen`) and directly before `export function SettingsScreen`; ONE word added in place to Task 7's line `const UNCONFIRMED_TEXT = "Saved — the server's answer could not be read; the screen will re-check.";`, which becomes `export const UNCONFIRMED_TEXT = …` (line-neutral; see Interfaces); TWO JSX lines in `SettingsScreen`'s one return: `<UnarmedExposureBanner />` directly after the `</header>` Task 6 wrote and directly before Task 7's `<UpdatesSection poll={poll} now={now} />` (above both sections), and `<NotificationsSection view={poll.view} reload={poll.reload} />` directly after that `<UpdatesSection poll={poll} now={now} />` line (Task 7's Updates `<section>` is rendered by `UpdatesSection`, a component placed after `SettingsScreen`, and by then holds Tasks 8–9's lists). Import additions are merged into the lines Tasks 6–9 already wrote (Step 4 names each). The Notifications section is the literal `<NotificationBell />` with the caption `Phone notifications for this browser` (and, when `pushSupported()` is false, `This browser cannot receive Web Push.` in its place — the bell renders nothing there, `NotificationBell.tsx:18`), then the release-notifications fieldset
- Modify: `pwa/src/fleet/fleet.css` — appended after the last line (Task 9's last appended rule): `.settings-unarmed` (red, SELF-GROUNDED — its own `background` and `color`, the `.fleet-host-banner` pair, `fleet.css:284-302` at `d759c914`) and `.settings-bell-row` (layout only, the tap floor) *(correction: the skeleton listed `.settings-unarmed` alone; the bell and its caption need a row that keeps `min-height: var(--tap-min)`. The section, the fieldset and its rows REUSE Task 7's `.settings-section`, `.settings-section-title`, `.settings-fieldset`, `.settings-legend`, `.settings-option`, `.settings-option-sentence` and `.settings-note` — including Task 7's `INHERITED_GROUNDS` registration of `.settings-note` — so this task adds no second copy of either shape)*
- NOT modified: `pwa/design/audit.mjs` — `.settings-unarmed` is self-grounded and `.settings-bell-row` sets no colour, so neither needs an `INHERITED_GROUNDS` entry (measured in Step 5)
- Test: `pwa/test/settings-screen.test.tsx` — three describes APPENDED after the file's last line, all named `SettingsScreen — notifications: …` so one `-t 'notifications:'` selects them: `…: helpers`, `…: the section (design 2026-09-20 §13 item 2)`, `…: the unarmed-exposure banner (design 2026-09-20 §12)`
- Run, not modified: `pwa/test/fleet-css.test.ts`, `pwa/test/contrast.test.ts`, `node design/contrast-check.mjs`, `npm run build`; from `server/`, `test/single-definition.test.ts` (it walks `pwa/src`: its `BASE_URL_OK is declared in exactly one file…` case scans for a re-spelled loopback set — the teeth of this task's reuse of `LOOPBACK_HOSTS`, Step 7 — and W2 Task 1's vocabulary scans read `NOTIFY_LABELS` and the `NOTIFY_MODES` loop) and `test/topology-clean.test.ts` (new fixture hostnames and addresses in a tracked file). NOT run for R13: no file this task edits is cited by `session-hook.test.ts`'s corpus (Task 8 measured the three documents at `d759c914`: no `SettingsScreen.tsx:`/`fleet.css:`/`settings-screen.test.tsx:` token)

**Interfaces:**
- Consumes: `NotificationBell` (`pwa/src/fleet/NotificationBell.tsx:9`, reused as is — never a second copy of its four outcomes, `:29-47`); `pushSupported` (`pwa/src/lib/push.ts:13`); `readAuthStatus` (`pwa/src/lib/auth.ts:192`, `Promise<Partial<AuthStatus>>`, rejects on a non-2xx and never raises auth-lost); `AuthStatus` (`shared/api.ts:6527`); `LOOPBACK_HOSTS` (`shared/base-url.ts:51`, L0, imports nothing — `['127.0.0.1', '[::1]', 'localhost']`, the spellings `URL.hostname` produces, IPv6 WITH brackets); `NOTIFY_MODES`, `NotifyMode`, `isNotifyMode`, `FLEET_SCOPE`, `UpdatesView`, `UpdateIntentWire`, `IntentWriteAnswer` (W2 Task 1 — `isNotifyMode` ADDED to the skeleton's list: the write's answer is read defensively); Task 5's `api.setUpdateIntent` (`postJsonOr` — resolves `'unreadable'` on a 2xx it cannot parse, rejects `ApiError` on a refusal), `updateErrorText`, `ApiError` (tests); Task 7's screen body — its one `const poll = useUpdatesView();` inside `SettingsScreen` (`poll.view` = the last good `UpdatesView`, whose `intent` `asUpdatesView` guarantees is an array; `poll.reload` = one poll now) and the `<UpdatesSection poll={poll} now={now} />` line it renders directly after `</header>` (both placement anchors), its `useId`/`useState` and `toast` imports, and **`UNCONFIRMED_TEXT`** *(correction, a cross-task interface the skeleton does not name: Task 7 declares the "unreadable" toast as a MODULE-PRIVATE `const UNCONFIRMED_TEXT = "Saved — the server's answer could not be read; the screen will re-check.";` beside `AUTO_GATE_NOTE`, read by its `writeIntent`. This task shows the SAME outcome for the same route, so it reads that one constant — never a second spelling — and adds the one word `export` to Task 7's line in place so its test can import it; it declares nothing of the kind)*; `ToastHost` (`pwa/src/components/Toast.tsx`, tests); `declValue`, `ruleIn` (`pwa/test/cssRule.ts:98`, `:139`).
- Precondition from Task 7, pinned here: the Updates section's first-load `<Skeleton/>` and its `not-configured` rendering are INSIDE that section (the skeleton's "nothing else of the section"), never an early `return` from `SettingsScreen` — the banner and the Notifications section render whatever `/api/updates` answers. The case `renders the section while /api/updates is pending and on a box with no control plane …` goes red if either state returns early.
- Produces (exported from `SettingsScreen.tsx`):

```ts
export const NOTIFY_LABELS: Record<NotifyMode, string> = { channel: 'on my channel', stable: 'stable only', off: 'off' };
/** The ONE spelling of the §12 sentence (the W4 doctor check will name the same route). */
export const UNARMED_EXPOSURE_TEXT =
  "The sign-in gate is off and this page was reached over a non-loopback address — anyone who can reach it can "
  + 'change what the fleet installs, and POST /api/updates/apply will let them install it. Arm the gate: '
  + 'CCRC_AUTH=on with CCRC_RP_ID and CCRC_ORIGIN, together (ccrc expose writes all three).';
/** (D-3298) true iff status?.mode === 'off' exactly AND !LOOPBACK_HOSTS.includes(hostname). */
export function unarmedExposure(status: Partial<AuthStatus> | null, hostname: string): boolean;
```

- Module-private (the screen is their one consumer; tests reach them through `<SettingsScreen/>`): `UnarmedExposureBanner()` — one `readAuthStatus()` per mount, `div.settings-unarmed[role="alert"]` holding `UNARMED_EXPOSURE_TEXT` iff `unarmedExposure(status, location.hostname)` (the bare `location` global, which `vi.stubGlobal('location', …)` replaces — the `block-screen.test.tsx:28` idiom), `null` on a rejected read; `NotificationsSection({ view, reload })` — `section.settings-section[aria-labelledby]` > `h2.settings-section-title` `Notifications` (Task 7's Updates-section shape, so the screen's two sections are one idiom and each is a named region), then the bell row (or the no-push sentence), then, iff `view !== null` (D-3311: spec §13 lists the choice unconditionally, but it is a write to `update_intent`, which a box with no coordination database does not have — while `/api/updates` is pending or answers `501 not-configured` the section shows the bell and no release radios, never three radios that would each answer the same refusal), `fieldset.settings-fieldset` > `legend.settings-legend` `Release notifications` > one `label.settings-option` > `input[type=radio][name=settings-notify][value=<mode>]` + `span.settings-option-sentence` per `NOTIFY_MODES` member, labelled by `NOTIFY_LABELS` (D-3299 — Task 7's channel/auto row shape).
- The write: a change calls `api.setUpdateIntent({ scope: FLEET_SCOPE, notify })`, then `reload()`. The CHECKED radio is `update_intent['*'].notify` read as `view.intent.find((i) => i.scope === FLEET_SCOPE)` (never `intent[0]`), overridden by the write in flight and then by the route's own answer (`IntentWriteAnswer.intent`) until the poll's `'*'` row carries a `setAt` at least as new — a controlled radio would otherwise snap back to the old choice for one poll *(correction: the skeleton said only "checked from the '*' row"; a controlled input checked from a 60 s poll visibly reverts the tap)*. While the write is in flight the fieldset is `disabled` and a second choice is ignored. `'unreadable'` (or an answer without a readable `intent`) → toast `UNCONFIRMED_TEXT` and show the stored row; a rejection → `toast(updateErrorText(err), 'error')` and show the stored row.
- Cases: `unarmedExposure` over the four quadrants plus `locked-out`, an absent `mode` and `null`; each `LOOPBACK_HOSTS` spelling (`'[::1]'`, `'localhost'`, `'127.0.0.1'`) → false and a documentation address `203.0.113.7` → true; the sentence names `POST /api/updates/apply` and the three arming settings; `NOTIFY_LABELS` labels exactly `NOTIFY_MODES`; the three radios in `NOTIFY_MODES` order, checked from the `'*'` row with a node row listed FIRST; a tap sends `{scope: '*', notify: 'stable'}` once and re-polls; the stored choice survives a lagging poll; a newer poll row wins; the in-flight fieldset is disabled and a second tap sends nothing; `'unreadable'` toasts and reverts; a `503 journal-unwritable` toasts the update sentence and reverts; the section renders (with no release radios) while `/api/updates` is pending and on `501 not-configured`; the literal bell renders where Web Push is supported, the no-push sentence where it is not; a source scan that the screen imports `NotificationBell` and spells none of its lifecycle calls or outcome toasts; the banner's four render quadrants (`'off'` + `ccrc.example` → shown, above the Updates heading and outside every section; `'off'` + `127.0.0.1` → none; `'passphrase'` + `ccrc.example` → none; a `404` and a network failure → none), `mode` absent → none, one status read per mount and no `/health` read; the CSS: self-grounded, not sticky, wrapping, and the bell row's tap floor.
- Spec rows pinned: §13 Pins' "the unarmed-non-loopback banner" and §13 item 2 (the push toggle reused, release notifications on `update_intent['*'].notify`). No §18 row names this task's guards (§18 has no banner or notify-setting row — measured); its mutation measurement (Step 7) is over the task's own guards, each named.

- [ ] **Step 1: Record the contrast audit's census before any edit**

Run: `cd pwa && node design/contrast-check.mjs | grep -E '^ALL [0-9]+ PASS$|rules set a colour with no ground'`
Expected: an `ALL <p> PASS` line and a `# <u> rules set a colour with no ground this auditor can recover …` line. Write both numbers down: after Step 5, `<p>` must rise by exactly 2 (one self-grounded rule, measured in two themes) and `<u>` must be unchanged. At `d759c914` with no W3 CSS they read `ALL 562 PASS` and `255`; after Tasks 6–9 they read whatever those tasks left, which is why this step measures rather than quotes.

- [ ] **Step 2: Write the failing tests**

Merge these names into `pwa/test/settings-screen.test.tsx`'s existing import lines (Task 6 created the file; Tasks 7–9 extended it) — add each name only to the line for its module, and only if that line does not already import it; open a new line only for a module no line imports yet (`'../../shared/base-url'` is expected to be the one new line — Task 7 already added `import { ToastHost } from '../src/components/Toast';`). A duplicated name is a TypeScript error under `npm run build`, an unused one is `noUnusedLocals`:

```tsx
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { IntentWriteAnswer, NotifyMode, UpdateIntentWire, UpdatesView } from '../../shared/api';
import { FLEET_SCOPE, NOTIFY_MODES } from '../../shared/api';
import { LOOPBACK_HOSTS } from '../../shared/base-url';
import { ToastHost } from '../src/components/Toast';
import {
  NOTIFY_LABELS, SettingsScreen, UNARMED_EXPOSURE_TEXT, UNCONFIRMED_TEXT, unarmedExposure,
} from '../src/screens/SettingsScreen';
import { ApiError, api } from '../src/lib/api';
import { declValue, ruleIn } from './cssRule';
```

Then APPEND after the file's last line. Every fixture is `t10`/`T10_`-prefixed and module-level only where two describes share it, so nothing collides with Tasks 7–9's fixtures; the file's full `afterEach` (Task 6, `accounts-screen.test.tsx:46-51`'s four resets) still runs after each case, and the two rendering describes add their own `afterEach(() => { vi.unstubAllGlobals(); })`, which vitest's stack hook order runs FIRST (`pwa/test/setup.ts`'s own comment relies on the same order):

```tsx
// ── Task 10: Notifications + the unarmed banner (design 2026-09-20 §12, §13) ──
// Fixtures are local to these describes, as Tasks 7–9 keep theirs. Every case
// that stubs a global (`fetch`, `location`, the three Web Push globals) undoes
// it in the describe's own afterEach, which vitest's stack order runs BEFORE
// the file-level reset — so `navigate('/')` there never meets a stubbed
// `location`.
const T10_T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const T10_NODE = '11111111-1111-4111-8111-111111111111';
/** One intent row. `scope` defaults to the fleet row the notifier reads. */
const t10Intent = (over: Partial<UpdateIntentWire> = {}): UpdateIntentWire => ({
  scope: FLEET_SCOPE, channel: 'stable', pinnedTag: null, auto: 'off', notify: 'channel',
  setAt: T10_T0, setBy: 'pwa', ...over,
});
/** A view that is only an intent list — the Notifications section reads nothing else. A NODE row is listed
 *  FIRST on purpose: W2 answers '*' first (`ORDER BY scope`), and a reader that took `intent[0]` would pass
 *  every fixture that kept that order. */
const t10View = (fleet: Partial<UpdateIntentWire> = {}): UpdatesView => ({
  catalogue: { lastOkAt: T10_T0, lastError: null },
  releases: [],
  nodes: [],
  intent: [t10Intent({ scope: T10_NODE, notify: 'off', setAt: T10_T0 - 1 }), t10Intent(fleet)],
});
const t10Answer = (notify: NotifyMode, setAt: number): IntentWriteAnswer =>
  ({ ok: true, intent: t10Intent({ notify, setAt }), epoch: 2 });
const t10Json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** `GET /api/auth/status` answers `answer`; any other URL is a 404 no case reads. Returns the mock, so a
 *  "nothing renders" case can wait for the read to have HAPPENED before asserting its absence. */
const t10AuthStatus = (answer: { status: number; body: unknown } | 'network') => {
  const f = vi.fn(async (url: unknown): Promise<Response> => {
    if (String(url) !== '/api/auth/status') return t10Json(404, { error: 'not-found' });
    if (answer === 'network') throw new TypeError('Failed to fetch');
    return t10Json(answer.status, answer.body);
  });
  vi.stubGlobal('fetch', f);
  return f;
};
const t10Host = (hostname: string): void => { vi.stubGlobal('location', { ...window.location, hostname }); };
/** A browser that CAN do Web Push, as far as `pushSupported()` looks (lib/push.ts:13); permission stays
 *  'default', so the bell's mount read (`pushEnabled`) answers false without touching the worker. */
const t10PushBrowser = (): void => {
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'default', requestPermission: vi.fn() });
  vi.stubGlobal('navigator', { ...navigator, serviceWorker: {} });
};
/** Let every microtask and 0 ms timer queued so far run (the status read's fetch → json → setState chain). */
const t10Settle = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const t10Group = (): Promise<HTMLElement> => screen.findByRole('group', { name: 'Release notifications' });

describe('SettingsScreen — notifications: helpers', () => {
  it('unarmedExposure: the gate reported off AND a non-loopback hostname — both, and nothing else', () => {
    expect(unarmedExposure({ mode: 'off' }, 'ccrc.example')).toBe(true);
    for (const host of LOOPBACK_HOSTS) expect(unarmedExposure({ mode: 'off' }, host)).toBe(false);
    expect(unarmedExposure({ mode: 'passphrase' }, 'ccrc.example')).toBe(false);
    expect(unarmedExposure({ mode: 'locked-out' }, 'ccrc.example')).toBe(false);
    // An older server's silence and a failed read are not "off" — a red banner is a claim about this box.
    expect(unarmedExposure({ authed: true }, 'ccrc.example')).toBe(false);
    expect(unarmedExposure(null, 'ccrc.example')).toBe(false);
  });

  it('unarmedExposure: the loopback spellings are shared/base-url.ts\'s own — [::1] with brackets, as URL writes it', () => {
    expect(unarmedExposure({ mode: 'off' }, '[::1]')).toBe(false);
    expect(unarmedExposure({ mode: 'off' }, 'localhost')).toBe(false);
    expect(unarmedExposure({ mode: 'off' }, '127.0.0.1')).toBe(false);
    expect(unarmedExposure({ mode: 'off' }, '203.0.113.7')).toBe(true);
  });

  it('the banner sentence names the route it warns about and the three settings that arm the gate', () => {
    expect(UNARMED_EXPOSURE_TEXT).toContain('POST /api/updates/apply');
    for (const word of ['CCRC_AUTH=on', 'CCRC_RP_ID', 'CCRC_ORIGIN']) expect(UNARMED_EXPOSURE_TEXT).toContain(word);
  });

  it('labels every NotifyMode, and nothing else', () => {
    expect(Object.keys(NOTIFY_LABELS).sort()).toEqual([...NOTIFY_MODES].sort());
  });
});

describe('SettingsScreen — notifications: the section (design 2026-09-20 §13 item 2)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('offers one native radio per NotifyMode, in NOTIFY_MODES order, checked from the \'*\' row', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'stable' }));
    render(<SettingsScreen />);
    const group = await t10Group();
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('value'))).toEqual([...NOTIFY_MODES]);
    expect(within(group).getByRole('radio', { name: 'stable only' })).toBeChecked();
    // The node row (listed first, notify 'off') is not what the fleet setting reads.
    expect(within(group).getByRole('radio', { name: 'off' })).not.toBeChecked();
    expect(within(group).getByRole('radio', { name: 'on my channel' })).not.toBeChecked();
  });

  it('a tap writes {scope: \'*\', notify} once, re-polls, and keeps the stored choice checked while the poll lags', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'channel' }));
    const write = vi.spyOn(api, 'setUpdateIntent').mockResolvedValue(t10Answer('stable', T10_T0 + 1));
    render(<SettingsScreen />);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'stable only' }));
    await waitFor(() => expect(updates).toHaveBeenCalledTimes(2));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ scope: FLEET_SCOPE, notify: 'stable' });
    await t10Settle();
    // The re-poll still answered the OLD row (setAt T0 < the answer's T0 + 1): the route's answer is shown.
    expect(within(group).getByRole('radio', { name: 'stable only' })).toBeChecked();
  });

  it('once the poll carries a row at least as new as the answer, the poll is what is checked', async () => {
    vi.spyOn(api, 'updates')
      .mockResolvedValueOnce(t10View({ notify: 'channel' }))
      .mockResolvedValue(t10View({ notify: 'off', setAt: T10_T0 + 5 }));   // another device, later
    vi.spyOn(api, 'setUpdateIntent').mockResolvedValue(t10Answer('stable', T10_T0 + 1));
    render(<SettingsScreen />);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'stable only' }));
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'off' })).toBeChecked());
  });

  it('a write in flight disables the three radios, so a second tap cannot race the first', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'channel' }));
    const write = vi.spyOn(api, 'setUpdateIntent').mockReturnValue(new Promise(() => {}));
    render(<SettingsScreen />);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'off' }));
    await waitFor(() => expect(within(group).getByRole('radio', { name: 'off' })).toBeDisabled());
    expect(within(group).getByRole('radio', { name: 'off' })).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: 'stable only' }));
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('an unreadable answer says the write may have landed and shows the stored row, not a guess', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'channel' }));
    vi.spyOn(api, 'setUpdateIntent').mockResolvedValue('unreadable');
    render(<><ToastHost /><SettingsScreen /></>);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'off' }));
    expect(await screen.findByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'on my channel' })).toBeChecked();
  });

  it('a refusal toasts the update route\'s own sentence and puts the stored choice back', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(t10View({ notify: 'channel' }));
    vi.spyOn(api, 'setUpdateIntent').mockRejectedValue(
      new ApiError(503, { ok: false, error: 'journal-unwritable', detail: 'EACCES' }));
    render(<><ToastHost /><SettingsScreen /></>);
    const group = await t10Group();
    fireEvent.click(within(group).getByRole('radio', { name: 'stable only' }));
    expect(await screen.findByText('The server cannot write its intent journal — nothing was changed.')).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: 'on my channel' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'stable only' })).not.toBeChecked();
  });

  it('renders the section while /api/updates is pending and on a box with no control plane — with no release radios', async () => {
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
    render(<SettingsScreen />);
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByText('This browser cannot receive Web Push.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Release notifications' })).toBeNull();
    cleanup();
    vi.spyOn(api, 'updates').mockRejectedValue(new ApiError(501, { ok: false, error: 'not-configured' }));
    render(<SettingsScreen />);
    await screen.findByText('This box has no update control plane — it runs without a coordination database.');
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Release notifications' })).toBeNull();
  });

  it('reuses the literal NotificationBell where the browser can do Web Push', async () => {
    t10PushBrowser();
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
    render(<SettingsScreen />);
    const section = screen.getByRole('heading', { name: 'Notifications' }).closest('section')!;
    const bell = await within(section).findByRole('button', { name: 'Notifications off' });
    expect(bell).toHaveClass('bell');
    expect(bell).toHaveAttribute('aria-pressed', 'false');
    expect(within(section).getByText('Phone notifications for this browser')).toBeInTheDocument();
    expect(within(section).queryByText('This browser cannot receive Web Push.')).toBeNull();
  });

  it('spells none of the bell\'s own outcomes — the toggle is reused, never copied (a literal-absence pin)', () => {
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'screens', 'SettingsScreen.tsx'), 'utf8');
    expect(src).toMatch(/import \{ NotificationBell \} from '\.\.\/fleet\/NotificationBell';/);
    expect(src).toMatch(/<NotificationBell \/>/);
    for (const copy of [/\benablePush\b/, /\bdisablePush\b/, /\bpushEnabled\b/, /Allow notifications in your browser/,
      /Push isn't set up on the server/, /Your browser blocks web push/]) {
      expect(src).not.toMatch(copy);
    }
  });
});

describe('SettingsScreen — notifications: the unarmed-exposure banner (design 2026-09-20 §12)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const banner = (): HTMLElement | null => document.querySelector<HTMLElement>('.settings-unarmed');

  it('shows the red sentence when the gate reports off and the page was reached over a non-loopback name', async () => {
    t10AuthStatus({ status: 200, body: { authed: true, passkeysEnrolled: 0, mode: 'off' } });
    t10Host('ccrc.example');
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));   // independent of the update view
    render(<SettingsScreen />);
    const shown = await screen.findByText(UNARMED_EXPOSURE_TEXT);
    expect(shown).toHaveClass('settings-unarmed');
    expect(shown).toHaveAttribute('role', 'alert');
    // Directly under the header: before the Updates section, not inside it.
    const updates = screen.getByRole('heading', { name: 'Updates' });
    expect(shown.compareDocumentPosition(updates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shown.closest('section')).toBeNull();
  });

  it('shows nothing when the gate is off but the page is on loopback', async () => {
    const f = t10AuthStatus({ status: 200, body: { authed: true, passkeysEnrolled: 0, mode: 'off' } });
    t10Host('127.0.0.1');
    vi.spyOn(api, 'updates').mockResolvedValue(t10View());
    render(<SettingsScreen />);
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/auth/status', expect.anything()));
    await t10Settle();
    expect(banner()).toBeNull();
  });

  it('shows nothing when the gate is armed, whatever the hostname', async () => {
    const f = t10AuthStatus({ status: 200, body: { authed: true, passkeysEnrolled: 1, mode: 'passphrase' } });
    t10Host('ccrc.example');
    vi.spyOn(api, 'updates').mockResolvedValue(t10View());
    render(<SettingsScreen />);
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/auth/status', expect.anything()));
    await t10Settle();
    expect(banner()).toBeNull();
  });

  it('shows nothing when the status read fails — a 404 from an older server, or no network', async () => {
    for (const answer of [{ status: 404, body: { error: 'not-found' } }, 'network'] as const) {
      const f = t10AuthStatus(answer);
      t10Host('ccrc.example');
      vi.spyOn(api, 'updates').mockResolvedValue(t10View());
      render(<SettingsScreen />);
      await waitFor(() => expect(f).toHaveBeenCalledWith('/api/auth/status', expect.anything()));
      await t10Settle();
      expect(banner()).toBeNull();
      cleanup();
    }
  });

  it('shows nothing when the status body carries no mode — silence is not "off"', async () => {
    const f = t10AuthStatus({ status: 200, body: { authed: false } });
    t10Host('ccrc.example');
    vi.spyOn(api, 'updates').mockResolvedValue(t10View());
    render(<SettingsScreen />);
    await waitFor(() => expect(f).toHaveBeenCalledWith('/api/auth/status', expect.anything()));
    await t10Settle();
    expect(banner()).toBeNull();
  });

  it('is self-grounded red, not sticky, and wraps inside the phone width; the bell row keeps the tap floor', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
    const red = ruleIn(css, '.settings-unarmed');
    expect(declValue(red, 'background')).toBe('var(--status-dead-tint-solid)');
    expect(declValue(red, 'color')).toBe('var(--status-dead-text)');
    expect(declValue(red, 'position')).toBeNull();
    expect(declValue(red, 'overflow-wrap')).toBe('anywhere');
    expect(declValue(ruleIn(css, '.settings-bell-row'), 'min-height')).toBe('var(--tap-min)');
  });

  it('reads the gate from /api/auth/status once per mount, never from /health', async () => {
    const f = t10AuthStatus({ status: 200, body: { authed: true, passkeysEnrolled: 0, mode: 'off' } });
    t10Host('ccrc.example');
    vi.spyOn(api, 'updates').mockResolvedValue(t10View());
    render(<SettingsScreen />);
    await screen.findByText(UNARMED_EXPOSURE_TEXT);
    const urls = f.mock.calls.map(([u]) => String(u));
    expect(urls.filter((u) => u === '/api/auth/status')).toHaveLength(1);
    expect(urls.some((u) => u.startsWith('/health'))).toBe(false);
  });
});
```

- [ ] **Step 3: Run the new describes to verify they fail**

Run: `cd pwa && ./node_modules/.bin/vitest run test/settings-screen.test.tsx -t 'notifications:'` (foreground; `npm ci` first if `pwa/node_modules` is absent)
Expected: FAIL — `Tests  20 failed (20)`, measured on a scratch copy carrying Task 5's client, W2's `shared/api.ts` block and a Task 6–7 stand-in screen (header, an Updates section with the `not-configured` sentence, the unreadable sentence exported as `UNCONFIRMED_TEXT`). *(Re-measure on the real Tasks 6–9 tree: there `UNCONFIRMED_TEXT` is still module-private until Step 4 exports it, so the unreadable case imports `undefined` — it is red either way, first on the missing `Release notifications` group.)* The helper cases fail on `TypeError: unarmedExposure is not a function`, `TypeError: Cannot convert undefined or null to object` (`Object.keys(NOTIFY_LABELS)`) and `the given combination of arguments (undefined and string) is invalid` (`UNARMED_EXPOSURE_TEXT`); the section cases on `Unable to find role="group" and name "Release notifications"` or `Unable to find … role "heading" and name "Notifications"`; the source scan on its `import { NotificationBell }` match; the four "shows nothing" banner cases are RED too, not vacuously green — each first waits for the status read to HAPPEN (`expected "vi.fn()" to be called with arguments: [ '/api/auth/status', Anything ]`), which nothing issues yet; the shown case and the once-per-mount case on `getByText(undefined)`; the CSS case on `no rule for .settings-unarmed`. Every Task 6–9 case in the file stays green: `./node_modules/.bin/vitest run test/settings-screen.test.tsx` shows no failure outside the three new describes.

- [ ] **Step 4: Implement the Notifications section and the banner in `pwa/src/screens/SettingsScreen.tsx`**

Merge the imports into the lines Tasks 6–9 wrote (one name per module line, never a second line for a module already imported):
- `'react'` — Task 7's `import { useId, useState } from 'react';` — add `useEffect` (this task also uses `useId` and `useState`, both already there);
- the `import type { … } from '../../../shared/api'` line (Task 7's, which already names `UpdatesView`) — add `AuthStatus`, `NotifyMode`;
- the value import from `'../../../shared/api'` (Task 7's `AUTO_MODES`, `FLEET_SCOPE`, `UPDATE_CHANNELS`, `UPDATE_GATE_CAP`, Task 8's `isReleaseTag`, `isUpdateChannel`, Task 9's `isStampRead`) — add `NOTIFY_MODES`, `isNotifyMode`;
- a NEW line `import { LOOPBACK_HOSTS } from '../../../shared/base-url';` beside the shared imports (no `pwa/src` file imports `shared/base-url` yet — measured; it is L0 and imports nothing, so the bundle gains nothing but the one array);
- the `'../lib/api'` import (Task 7's `ApiError`, `api`, `updateErrorText`, Task 8's `MOVE_DISABLED_TEXT`) — nothing to add; `toast` from `'../components/Toast'` is Task 7's;
- NEW lines `import { NotificationBell } from '../fleet/NotificationBell';` (exactly this spelling — Step 2's source scan matches it), `import { readAuthStatus } from '../lib/auth';` and `import { pushSupported } from '../lib/push';`.

In place, on Task 7's line, add the one word `export` (no line added or removed):

```tsx
export const UNCONFIRMED_TEXT = "Saved — the server's answer could not be read; the screen will re-check.";
```

Insert after Task 9's `function NodeList(…) { … }` and directly before `export function SettingsScreen`:

```tsx
// ── Notifications (spec §13 item 2, §12's unarmed banner; programme wave 3 Task 10) ──
// Two things live here, and one thing deliberately does not:
//   * The PHONE-PUSH toggle is the literal <NotificationBell/> — the same
//     component the fleet header mounts, with its four subscribe outcomes
//     (NotificationBell.tsx:29-47). This file imports none of lib/push's
//     lifecycle calls and spells none of those outcomes; a second copy of the
//     toggle is how two surfaces would come to disagree about whether this
//     browser is subscribed. `pushSupported()` is read here only to say why the
//     bell is absent (it renders nothing where Web Push cannot work).
//   * RELEASE NOTIFICATIONS are `update_intent['*'].notify` (W2's NotifyMode
//     column): one native radio per NOTIFY_MODES member
//     (D-3299), written through the one intent route.
//     The server's notifier (Task 3) reads the '*' row alone, so a per-node
//     scope is never offered here.
//   * NOT HERE: the release push itself. A tap on one of these radios changes
//     which tags the server will announce from the next sweep on; it sends
//     nothing and marks nothing.
//
// THE UNARMED-EXPOSURE BANNER (spec §12) sits above both sections. Its trigger
// is `AuthStatus.mode === 'off'` from the unauthenticated GET /api/auth/status
// (D-3298 — /health reports no gate state), AND a
// page origin whose hostname is not one of shared/base-url.ts's
// LOOPBACK_HOSTS: the one list of loopback spellings, reused rather than
// re-spelled (single-definition.test.ts's LOOP_SET scan holds that). Every
// non-answer draws NOTHING — a failed read, an older server with no route, a
// body without `mode` — because a red banner is a claim about this box, and a
// status read that told us nothing is not evidence of an open gate.

export const NOTIFY_LABELS: Record<NotifyMode, string> = { channel: 'on my channel', stable: 'stable only', off: 'off' };

/** The ONE spelling of the §12 sentence (the W4 doctor check will name the same route). */
export const UNARMED_EXPOSURE_TEXT =
  "The sign-in gate is off and this page was reached over a non-loopback address — anyone who can reach it can "
  + 'change what the fleet installs, and POST /api/updates/apply will let them install it. Arm the gate: '
  + 'CCRC_AUTH=on with CCRC_RP_ID and CCRC_ORIGIN, together (ccrc expose writes all three).';

/** (D-3298) true iff status?.mode === 'off' exactly AND !LOOPBACK_HOSTS.includes(hostname). */
export function unarmedExposure(status: Partial<AuthStatus> | null, hostname: string): boolean {
  return status?.mode === 'off' && !LOOPBACK_HOSTS.includes(hostname);
}

/** One status read per mount — the AccountsScreen `AuthSection` shape, whose
 *  argument (one extra anonymous GET on a rarely-visited screen, and a reader
 *  that never raises auth-lost) carries over unchanged. */
function UnarmedExposureBanner(): ReactNode {
  const [status, setStatus] = useState<Partial<AuthStatus> | null>(null);
  useEffect(() => {
    let live = true;
    void readAuthStatus()
      .then((s) => { if (live) setStatus(s); })
      .catch(() => { /* an older server, a proxy's 404, no network: this box told us nothing — draw nothing */ });
    return () => { live = false; };
  }, []);
  if (!unarmedExposure(status, location.hostname)) return null;
  return <div className="settings-unarmed" role="alert">{UNARMED_EXPOSURE_TEXT}</div>;
}

/** What the release-notifications radios show. `setAt: null` = a write in
 *  flight; a number = the route's own answer, shown until the poll's '*' row is
 *  at least that new — a controlled radio would otherwise snap back to the old
 *  choice for the length of one poll. */
interface ShownNotify { notify: NotifyMode; setAt: number | null }

function NotificationsSection({ view, reload }: { view: UpdatesView | null; reload: () => void }): ReactNode {
  const titleId = useId();
  const [supported] = useState(() => pushSupported());
  const [shown, setShown] = useState<ShownNotify | null>(null);
  const row = view === null ? null : (view.intent.find((i) => i.scope === FLEET_SCOPE) ?? null);
  const caughtUp = shown !== null && shown.setAt !== null && row !== null && row.setAt >= shown.setAt;
  const checked = shown !== null && !caughtUp ? shown.notify : (row?.notify ?? null);
  const saving = shown !== null && shown.setAt === null;

  const choose = async (notify: NotifyMode): Promise<void> => {
    if (saving) return;   // the disabled fieldset stops a finger; this stops a second call
    setShown({ notify, setAt: null });
    try {
      const answer = await api.setUpdateIntent({ scope: FLEET_SCOPE, notify });
      const stored = answer === 'unreadable' ? null : (answer?.intent ?? null);
      if (stored === null || !isNotifyMode(stored.notify) || typeof stored.setAt !== 'number') {
        // The write may have landed: say so, and let the poll decide what is checked.
        setShown(null);
        toast(UNCONFIRMED_TEXT);
      } else {
        setShown({ notify: stored.notify, setAt: stored.setAt });
      }
    } catch (err) {
      setShown(null);
      toast(updateErrorText(err), 'error');
    }
    reload();
  };

  return (
    <section className="settings-section" aria-labelledby={titleId}>
      <h2 id={titleId} className="settings-section-title">Notifications</h2>
      {supported ? (
        <div className="settings-bell-row">
          <NotificationBell />
          <span>Phone notifications for this browser</span>
        </div>
      ) : (
        <p className="settings-note">This browser cannot receive Web Push.</p>
      )}
      {view !== null && (
        <fieldset className="settings-fieldset" disabled={saving}>
          <legend className="settings-legend">Release notifications</legend>
          {NOTIFY_MODES.map((m) => (
            <label key={m} className="settings-option">
              <input
                type="radio"
                name="settings-notify"
                value={m}
                checked={checked === m}
                onChange={() => void choose(m)}
              />
              <span className="settings-option-sentence">{NOTIFY_LABELS[m]}</span>
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
}
```

Then, inside `SettingsScreen`'s return, add ONE line directly after the `</header>` Task 6 wrote and directly before Task 7's `<UpdatesSection poll={poll} now={now} />`:

```tsx
      <UnarmedExposureBanner />
```

and ONE line directly after Task 7's `<UpdatesSection poll={poll} now={now} />` (`poll` is Task 7's binding of the screen's one `useUpdatesView()`, `const poll = useUpdatesView();`; this task adds no second call), so the return reads `</header>`, the banner, `<UpdatesSection …/>`, `<NotificationsSection …/>`, `</div>`:

```tsx
      <NotificationsSection view={poll.view} reload={poll.reload} />
```

The banner mounts ONE `readAuthStatus()` per settings mount, the `AccountsScreen` `AuthSection` precedent (`AccountsScreen.tsx:466-498`: one extra anonymous GET on a rarely-visited screen, and a reader that cannot raise auth-lost). Suites that render the screen without stubbing `fetch` (Tasks 6–9's) are unaffected: Node's `fetch` rejects a relative URL, the `.catch` swallows it, and nothing renders — measured, those cases stay green in Step 6.

- [ ] **Step 5: Append the CSS and measure the audit**

Append to `pwa/src/fleet/fleet.css`, after its last line:

```css

/* — centralised update management W3, Task 10: Notifications + the unarmed banner —
   .settings-unarmed is the §12 red sentence: the gate is off and this page
   was reached over a non-loopback address. It is SELF-GROUNDED — its own
   background AND colour, the .fleet-host-banner pair (--status-dead-text on
   --status-dead-tint-solid, the 12% wash pre-composited on --bg-surface) — so
   the auditor measures it with no INHERITED_GROUNDS registration, and it is
   not sticky: it heads a screen, it does not float over a list.
   .settings-bell-row is layout only (it sets no colour): the reused
   NotificationBell button beside its one-line caption, at the tap floor. */
.settings-unarmed {
  margin: 0 0 var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--status-dead);
  border-radius: var(--r-md);
  background: var(--status-dead-tint-solid);
  color: var(--status-dead-text);
  font: var(--weight-regular) var(--text-sm) / var(--leading-normal) var(--font-ui);
  overflow-wrap: anywhere;
}
.settings-bell-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: var(--tap-min);
}
```

Run: `cd pwa && node design/contrast-check.mjs | grep -E '^ALL [0-9]+ PASS$|rules set a colour with no ground|settings-unarmed'`
Expected: `ALL <p+2> PASS` (Step 1's `<p>` plus 2), the uncovered line still reading Step 1's `<u>`, and two `PASS` rows — measured on a copy of `pwa/` at `d759c914` with this exact CSS: `PASS    5.88  (min 4.5)  DARK  fleet.css .settings-unarmed  var(--status-dead-text) on var(--status-dead-tint-solid)` and `PASS    4.81  (min 4.5)  LIGHT fleet.css .settings-unarmed …` (`ALL 562 PASS` → `ALL 564 PASS`, `255` → `255`). Then `node design/contrast-check.mjs --uncovered | grep -E '^#   fleet\.css \.settings-(unarmed|bell-row)'` prints nothing (neither rule is in the uncovered census; `.settings-bell-row` sets no colour and is not audited at all).

- [ ] **Step 6: Run green**

Run, one at a time, foreground, from `pwa/`:
`./node_modules/.bin/vitest run test/settings-screen.test.tsx -t 'notifications:'` → `Tests  20 passed` (measured on the scratch copy of Step 3: `20 passed (20)`)
`./node_modules/.bin/vitest run test/settings-screen.test.tsx` → PASS, every case (the 20 new ones and every Task 6–9 case)
`./node_modules/.bin/vitest run test/fleet-css.test.ts test/contrast.test.ts` → PASS (measured on the scratch copy with this CSS: `Test Files  2 passed (2)`, `Tests  321 passed (321)`)
`node design/contrast-check.mjs` → exit 0, `ALL <p+2> PASS`
`npm run build` → `tsc --noEmit` clean (measured on the scratch copy: no output), then the Vite build

Run, from `server/`:
`./node_modules/.bin/vitest run test/single-definition.test.ts -t 'BASE_URL_OK'` → `Tests  1 passed | … skipped` (the loopback set still has the one holder `shared/base-url.ts`: the screen reads the array, never re-spells it)
`./node_modules/.bin/vitest run test/single-definition.test.ts` → PASS, every case (the file walks `pwa/src`: W2 Task 1's vocabulary scans read this task's `NOTIFY_LABELS` and `NOTIFY_MODES` loop, which spell no member list)
`./node_modules/.bin/vitest run test/topology-clean.test.ts` → PASS (the fixtures speak `ccrc.example`, a reserved TLD, and `203.0.113.7`, TEST-NET-3 — never a CGNAT `100.64/10` literal, which that suite's tailnet rule reds)

- [ ] **Step 7: Mutation measurement (no §18 row — spec §13 Pins' "the unarmed-non-loopback banner" and §13 item 2; the task's own guards)**

Each mutation is one hand edit to `pwa/src/screens/SettingsScreen.tsx`, the named cases run red, then the edit reversed by hand (never `git checkout --`, which would discard this task's uncommitted work) and the restore confirmed by `grep -c` on the original text printing `1`. Run each with `cd pwa && ./node_modules/.bin/vitest run test/settings-screen.test.tsx -t 'notifications:'` unless another command is named. Every count below was measured on the Step 3 scratch copy.

1. The gate word is `'off'` EXACTLY — in `unarmedExposure`, change `return status?.mode === 'off' && !LOOPBACK_HOSTS.includes(hostname);` to `return status?.mode !== 'passphrase' && !LOOPBACK_HOSTS.includes(hostname);` → RED, 3 cases: `unarmedExposure: the gate reported off AND a non-loopback hostname …` (`locked-out`, absent `mode`, `null`), `shows nothing when the status read fails …` and `shows nothing when the status body carries no mode …`. Reverse; `grep -c "return status?.mode === 'off' && !LOOPBACK_HOSTS.includes(hostname);" pwa/src/screens/SettingsScreen.tsx` → `1`.
2. The origin half — change the same line to `return status?.mode === 'off';` → RED, 3 cases: both `unarmedExposure` helper cases and `shows nothing when the gate is off but the page is on loopback`. Reverse; the same `grep -c` → `1`.
3. The loopback list is REUSED — change the same line to `return status?.mode === 'off' && !['127.0.0.1', '[::1]', 'localhost'].includes(hostname);` and run `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts -t 'BASE_URL_OK'` → RED: `BASE_URL_OK is declared in exactly one file, and it is not the table` (`expected [ 'shared/base-url.ts', …(1) ] to deeply equal [ 'shared/base-url.ts' ]`, the extra holder `pwa/src/screens/SettingsScreen.tsx`). The pwa cases stay green here — which is the point: behaviour cannot see a copy, the scan can. Reverse; the same `grep -c` → `1`.
4. The fleet row, by scope — in `NotificationsSection`, change the line `  const row = view === null ? null : (view.intent.find((i) => i.scope === FLEET_SCOPE) ?? null);` to `  const row = view === null ? null : (view.intent[0] ?? null);` (the whole line: Task 7's `UpdatesBody` spells the same `view.intent.find((i) => i.scope === FLEET_SCOPE) ?? null` fragment, so the fragment alone names two sites) → RED, 5 cases (the node row the fixtures list first is read instead): `offers one native radio per NotifyMode …`, `once the poll carries a row at least as new …`, `a write in flight disables …`, `an unreadable answer …`, `a refusal toasts …`. Reverse; `grep -c 'const row = view === null ? null : (view.intent.find((i) => i.scope === FLEET_SCOPE) ?? null);' pwa/src/screens/SettingsScreen.tsx` → `1`.
5. The route's answer is shown until the poll catches up — change `const checked = shown !== null && !caughtUp ? shown.notify : (row?.notify ?? null);` to `const checked = row?.notify ?? null;` → RED, 2 cases: `a tap writes {scope: '*', notify} once, re-polls, and keeps the stored choice checked while the poll lags` and `a write in flight disables …`. (`caughtUp` and `shown` then go unused — `npm run build` would also refuse the mutant under `noUnusedLocals`; vitest strips types, so the behavioural red is the one measured.) Reverse; `grep -c 'const checked = shown !== null && !caughtUp ? shown.notify : (row?.notify ?? null);' pwa/src/screens/SettingsScreen.tsx` → `1`.
6. A refusal puts the stored choice back — in `choose`'s `catch`, delete the line `      setShown(null);` that directly follows `    } catch (err) {` → RED, 1 case: `a refusal toasts the update route's own sentence and puts the stored choice back`. Reverse; `grep -A2 '    } catch (err) {' pwa/src/screens/SettingsScreen.tsx` prints `      setShown(null);` then `      toast(updateErrorText(err), 'error');` under it (the `catch (err)` block is this task's alone — Tasks 7 and 9 handle rejections in `.then(…, (err: unknown) => …)`/`.catch(…)` — whereas the toast line alone is spelled by Tasks 7 and 9 too, so a `grep -c` on it would not read `1`).
7. One write at a time — delete the line `    if (saving) return;   // the disabled fieldset stops a finger; this stops a second call` → RED, 1 case: `a write in flight disables the three radios, so a second tap cannot race the first` (`expected "setUpdateIntent" to be called 1 times, but got 2 times` — a synthetic click reaches an input inside a disabled `<fieldset>`, because React only honours an input's OWN `disabled` prop, so the fieldset alone is not the guard). Reverse; `grep -c 'if (saving) return;' pwa/src/screens/SettingsScreen.tsx` → `1`.
8. No release radios without a view — in `NotificationsSection`, change the line `      {view !== null && (` that sits directly above `        <fieldset className="settings-fieldset" disabled={saving}>` and `          <legend className="settings-legend">Release notifications</legend>` (the legend line is unique in the file; Tasks 7–9 may spell the other two elsewhere) to `      {(` → RED, 1 case: `renders the section while /api/updates is pending and on a box with no control plane — with no release radios`. Reverse; `grep -B2 'Release notifications</legend>' pwa/src/screens/SettingsScreen.tsx` prints `{view !== null && (` two lines above the legend.
9. The bell is the literal component — delete the line `          <NotificationBell />` → RED, 2 cases: `reuses the literal NotificationBell where the browser can do Web Push` and `spells none of the bell's own outcomes …`. Reverse; `grep -c '<NotificationBell />' pwa/src/screens/SettingsScreen.tsx` → `1`.
10. The banner heads the screen — move the line `      <UnarmedExposureBanner />` from directly under `</header>` in `SettingsScreen` to directly after `<h2 id={titleId} className="settings-section-title">Updates</h2>` in Task 7's `UpdatesSection` → RED, 1 case: `shows the red sentence when the gate reports off …` (the sentence now sits inside a `section`, after the heading). Move it back; `grep -B1 '<UnarmedExposureBanner />' pwa/src/screens/SettingsScreen.tsx` prints `</header>` on the line above.

After the last reversal, `./node_modules/.bin/vitest run test/settings-screen.test.tsx` is green again with the Step 6 count, and `git diff --stat` lists only the three files this task edits.

- [ ] **Step 8: Commit**

```bash
git add pwa/src/screens/SettingsScreen.tsx pwa/src/fleet/fleet.css pwa/test/settings-screen.test.tsx
git commit -m "feat(update): /settings Notifications — the reused bell, release notifications on the '*' row, and the unarmed-exposure banner"
```

### Task 11: UpdateBanner

**Files:**
- Create: `pwa/src/fleet/UpdateBanner.tsx`
- Modify: `pwa/src/screens/FleetScreen.tsx` — `import { UpdateBanner } from '../fleet/UpdateBanner';` and `import { useUpdatesView } from '../fleet/useUpdatesView';` directly after the quoted import `import { useFleetHealth } from '../fleet/useFleetHealth';` (`:15` at `d759c914`); `const updates = useUpdatesView();` directly after the quoted `const fleetHealth = useFleetHealth();` (`:444`), with the two-line comment above it extended (one poll, handed down); `<UpdateBanner updates={updates.view} />` directly after the quoted `<FleetHostBanner health={fleetHealth} />` (`:573`). Anchored by QUOTED TEXT, not by line: Task 6 inserts the Settings door into `.fleet-head-right` (`:536-571`) before this task runs. Two source comments cite lines of this file (`RunsScreen.tsx:717` → `FleetScreen.tsx:288-294`, `useProjectedHome.ts:19` → `FleetScreen.tsx:145`); both have already drifted at `d759c914` and no suite reads them (measured: `git grep -n "FleetScreen.tsx:[0-9]"` over `server/test` and `pwa/test` answers nothing), so the two inserted import lines are not line-neutral and need not be. The source scans that read this file (`fleet-css.test.ts:1105-1111`, `:1161-1171`, `session-line.test.tsx:928`) look for `<header className="fleet-head">`, `</header>`, `fleet-runs-line`, `<HotFilesStrip />` and a `SessionLine` import — none of which this task touches.
- Modify: `pwa/test/fleet-screen.test.tsx` — the import at `:4` gains `type NodeWire, type UpdatesView` (in place, one line); the file-level `beforeEach` (`:20-24`) gains a default `vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}))` so no case issues a real fetch for it and no banner appears in a case that is not about one (`:2246`'s bare `getByRole('status')` stays unambiguous); the `ticksOf` docstring's census (`:2374-2376`) names `useUpdatesView` (60_000) beside `FleetHostBanner` (15_000 + 30_000) — its instrument (presence of `1_000`) is unchanged; one describe APPENDED after the file's last line — after Task 6's appended `describe('the door to /settings (centralised update management §13)', …)` (the file ended at `:2606` at `d759c914`; Task 6 appended below it, so anchor on that describe's closing `});`, not on a line number). Every anchor this task quotes into the file (`:4`, `:20-24`, `:2246`, `:2374-2376`) is above Task 6's append and unmoved by it. No suite or audit document cites a line of this file (measured: `git grep -n "fleet-screen.test.tsx:[0-9]"` over `README.md`, `CLAUDE.md`, `server/test`, `pwa/test`, `pwa/src`, `shared` answers nothing).
- Modify: `pwa/src/fleet/fleet.css` — appended after its last line (`:2943` at `d759c914`, or after whatever Tasks 6–10 appended): `.update-banner` (a DISTINCT class, self-grounded — its own `background` and `color`, the `--accent-tint`/`--ink-primary` pair `tokens.css` already prices at 13.43:1 dark (`:65`) and 14.19:1 light (`:337`) — never `.fleet-host-banner--warn`), `.update-banner-msg`, `.update-banner-actions`, one grouped override for the two shared buttons inside it, and `.update-banner-note`. None of the last four sets `color`, so `pwa/design/audit.mjs` needs no `INHERITED_GROUNDS` entry and `contrast.test.ts`'s "contains no identities beyond the grandfathered blind spots" stays green.
- Test: `pwa/test/update-banner.test.tsx` (create)

**Interfaces:**
- Consumes: Task 5's `useUpdatesView(pollMs?)` → `UpdatesPoll` (`view` = the last good answer; `pollMs <= 0` = no request, no interval, no listener), `UPDATES_POLL_MS`, `pendingTag` (as Task 9 amended it: `if (n.stampRead !== 'ok') return null;` and `if (n.os === 'darwin') return null;` directly after its channel guard, D-3307 and D-3309 — so a node whose stamp was not READ, or a macOS node, draws no arrow and cannot raise this banner; inherited, not restated here), `nodeVersion` (`pwa/src/fleet/useUpdatesView.ts`) and `MOVE_DISABLED_TEXT`, `api.updates` (`pwa/src/lib/api.ts`); Task 3's `versionsSummary(rows: readonly SummaryRow[]): string` (`SummaryRow { role: string | null; version: string | null }`) and `MISSING_SIDE` (`shared/update-summary.ts` — `MISSING_SIDE` is not imported here: its value `'—'` is what the missing-side case's expected sentence spells); W2's `compareReleaseTags` (`shared/semver.ts`, `-1 | 0 | 1`); `navigate` (`pwa/src/lib/router.ts:17`); W2's `UpdatesView`, `NodeWire`, `UpdateChannel` (`shared/api.ts`, the end-of-file update block); `BuildInfo` (`shared/buildinfo.ts:28-41`) for fixtures; `ruleIn`, `declValue` (`pwa/test/cssRule.ts:98`, `:139`).
- Produces:

```tsx
/** The newest pendingTag across view.nodes, with that node's channel; null when catalogue.lastOkAt is not a number
 *  or no node has a pendingTag. The channel is read through pendingTag's contract (it answers a tag only when
 *  the node's channel is an UpdateChannel) — never re-derived here, so the arrow predicate stays one predicate. */
export function bannerRelease(view: UpdatesView): { tag: string; channel: UpdateChannel } | null;
/** `${tag} is out on ${channel} — ${versionsSummary(measured nodes as {role, version: nodeVersion})}.`, or null.
 *  "Measured" = typeof measuredAt === 'number': a never-measured row is a MISSING side ('—'), never 'unversioned'. */
export function updateBannerText(view: UpdatesView): string | null;
/** The FleetHostBanner idiom: `updates` injected → no poll (useUpdatesView(0)); undefined → self-polls
 *  (useUpdatesView(UPDATES_POLL_MS)); null when silent; div.update-banner[role="status"]. */
export function UpdateBanner({ updates }?: { updates?: UpdatesView | null }): ReactNode;
```

- The banner renders `updateBannerText` in `span.update-banner-msg`, an `Update all` button (`btn-ghost`) `disabled` and `aria-describedby` a `span.update-banner-note` carrying `MOVE_DISABLED_TEXT`, and a `See what's new` button (`btn-primary`) calling `navigate('/settings')`. It renders in local mode too (one `both` node reads as both sides). `UpdateBanner.tsx` never spells the summary clause itself — not even in a comment — because Task 3's appended `single-definition.test.ts` case holds `'fleet and server are on '` to one file across the four TS roots, and `pwa/src` is one of them (`single-definition.test.ts:34-39`).
- Cases (spec §13 Pins): renders on newer (`v0.0.9 is out on stable — fleet and server are on v0.0.7.`), the per-node form (`fleet v0.0.7 · server v0.0.9`), an unversioned node counts as behind, a never-measured row is a missing side (`fleet — · server v0.0.7`), local mode's one `both` row; not on equal (nor on a desired OLDER than current), not on `lastOkAt: null`, not on an unmeasured node (`measuredAt: null` — the fixture's ONLY blocking field: its stamp was read and it runs `v0.0.7`, so the case pins `pendingTag`'s `measuredAt` clause on this surface rather than passing on the read-stamp guard), not on `channel: null`, not on a macOS node (`os: 'darwin'`, D-3309 — the banner, BuildLine and the inventory row agree through `pendingTag`), not on `updates={null}`; picks `v0.0.10` over `v0.0.9` in both node orders; `Update all` disabled with the sentence as its accessible description; `See what's new` lands on `/settings`; the injected prop never calls `api.updates` (spied); self-polls when nothing is injected; a failed poll after a newer-release poll keeps the banner (Review Focus 4); the two buttons keep the shared tap floor; queried by its text and class, never by a bare `getByRole('status')` (FleetHostBanner, BuildLine, SubstrateBanner and the mark-seen note's status region share the screen). FleetScreen: one `api.updates` call per mount, handed to the banner.
- Spec §18 rows pinned: "unreachable is not current" (the banner surface — mutations: drop the `lastOkAt` check → the `lastOkAt: null` case reds; drop `pendingTag`'s `measuredAt` clause → the `measuredAt: null` case reds), "the move controls are disabled in W3" (Update all — mutation: drop `disabled` → reds). Decision 17 on this surface: drop `pendingTag`'s Darwin clause → the macOS case reds.

- [ ] **Step 1: Write the failing banner suite**

Create `pwa/test/update-banner.test.tsx`:

```tsx
// UpdateBanner (centralised-update design 2026-09-20 §13; programme wave 3) —
// the fleet screen's "a release is out" line. The spec's four pins (renders on
// newer, not on equal, not on lastOkAt: null, not on an unmeasured node), the
// arrow predicate's other half (channel: null), semver order across the
// v0.0.9/v0.0.10 boundary, the disabled Update all, the door to /settings, and
// the FleetHostBanner idiom's injected/self-polling split.
//
// Found by CLASS and TEXT, never by a bare getByRole('status'): FleetHostBanner,
// BuildLine, SubstrateBanner and the mark-seen note are status regions too,
// and a screen showing two of them makes that query ambiguous.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { NodeWire, UpdatesView } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { api, MOVE_DISABLED_TEXT } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';
import { UPDATES_POLL_MS } from '../src/fleet/useUpdatesView';
import { bannerRelease, UpdateBanner, updateBannerText } from '../src/fleet/UpdateBanner';
import { declValue, ruleIn } from './cssRule';

const fleetCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
const primitivesCss = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'components', 'primitives.css'), 'utf8');
const bannerSrc = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'UpdateBanner.tsx'), 'utf8');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false }));
});

const NOW = Date.now();
const FLEET_ID = '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10';
const SERVER_ID = '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93';

/** A stamp; `version` omitted = an unversioned (deploy.sh) build. */
const stamp = (version?: string): BuildInfo => ({
  sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false,
  ...(version === undefined ? {} : { version }),
});

/** A measured, reachable, stable-channel fleet node on v0.0.7 whose desired is
 *  v0.0.9 — every case edits the one field it is about. */
const fleetNode = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: FLEET_ID, role: 'fleet', label: 'fleet', os: 'linux',
  current: stamp('v0.0.7'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['update-gate'], agentOps: [], highestVersion: 'v0.0.7', previousVersion: null,
  measuredAt: NOW - 60_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});
/** The server's own row: no agent by construction (`agentOps: null`). */
const serverNode = (over: Partial<NodeWire> = {}): NodeWire =>
  fleetNode({ nodeId: SERVER_ID, role: 'server', label: 'server', agentOps: null, ...over });

const view = (over: Partial<UpdatesView> = {}): UpdatesView => ({
  catalogue: { lastOkAt: NOW - 4 * 60_000, lastError: null },
  releases: [],
  nodes: [fleetNode(), serverNode()],
  intent: [],
  ...over,
});

const banner = (): Element | null => document.querySelector('.update-banner');

describe('UpdateBanner — when it speaks', () => {
  it('renders on a newer release: the tag, the channel, and what the fleet runs', () => {
    render(<UpdateBanner updates={view()} />);
    expect(screen.getByText('v0.0.9 is out on stable — fleet and server are on v0.0.7.')).toBeInTheDocument();
    expect(banner()).not.toBeNull();
    expect(banner()!.getAttribute('role')).toBe('status');
  });

  it('names each side when the two boxes disagree — the per-node form', () => {
    render(<UpdateBanner updates={view({
      nodes: [fleetNode(), serverNode({ current: stamp('v0.0.9'), highestVersion: 'v0.0.9' })],
    })} />);
    expect(screen.getByText('v0.0.9 is out on stable — fleet v0.0.7 · server v0.0.9.')).toBeInTheDocument();
  });

  it('counts an unversioned node as behind, and the summary says unversioned', () => {
    render(<UpdateBanner updates={view({
      nodes: [fleetNode({ current: stamp() }), serverNode({ current: stamp('v0.0.9') })],
    })} />);
    expect(screen.getByText('v0.0.9 is out on stable — fleet unversioned · server v0.0.9.')).toBeInTheDocument();
  });

  it('reports a never-measured row as a MISSING side, not as an unversioned one', () => {
    // The server is measured and behind, so the banner speaks; the fleet row is
    // a placeholder nobody has measured. "unversioned" would state a
    // measurement nobody made — the summary says the side is missing instead.
    render(<UpdateBanner updates={view({
      nodes: [fleetNode({ measuredAt: null, current: null, stampRead: 'absent' }), serverNode()],
    })} />);
    expect(screen.getByText('v0.0.9 is out on stable — fleet — · server v0.0.7.')).toBeInTheDocument();
  });

  it('renders in local mode: the one node that is both reads as both sides', () => {
    render(<UpdateBanner updates={view({ nodes: [serverNode({ role: 'both' })] })} />);
    expect(screen.getByText('v0.0.9 is out on stable — fleet and server are on v0.0.7.')).toBeInTheDocument();
  });

  it("picks the NEWEST pending tag in semver order — v0.0.10 over v0.0.9 — with that node's channel", () => {
    // String order puts 'v0.0.9' above 'v0.0.10'; both node orders are checked,
    // so neither first-wins nor last-wins can pass by accident.
    render(<UpdateBanner updates={view({
      nodes: [fleetNode({ desiredTag: 'v0.0.9' }), serverNode({ channel: 'dev', desiredTag: 'v0.0.10' })],
    })} />);
    expect(screen.getByText('v0.0.10 is out on dev — fleet and server are on v0.0.7.')).toBeInTheDocument();
    expect(bannerRelease(view({
      nodes: [serverNode({ channel: 'dev', desiredTag: 'v0.0.10' }), fleetNode({ desiredTag: 'v0.0.9' })],
    }))).toEqual({ tag: 'v0.0.10', channel: 'dev' });
  });
});

describe('UpdateBanner — when it stays silent (unreachable is not current, spec §7 and §18)', () => {
  it('is silent when every node runs its desired tag, and when a desired is OLDER than what runs', () => {
    const equal = render(<UpdateBanner updates={view({
      nodes: [
        fleetNode({ current: stamp('v0.0.9'), desiredTag: 'v0.0.9' }),
        serverNode({ current: stamp('v0.0.9'), desiredTag: 'v0.0.9' }),
      ],
    })} />);
    expect(equal.container).toBeEmptyDOMElement();
    expect(updateBannerText(view({
      nodes: [fleetNode({ current: stamp('v0.0.9'), desiredTag: 'v0.0.7' })],
    }))).toBeNull();
  });

  it('is silent while the catalogue has never been reached since the server started (lastOkAt: null)', () => {
    const { container } = render(<UpdateBanner updates={view({
      catalogue: { lastOkAt: null, lastError: { at: NOW - 30_000, reason: 'rate-limited' } },
    })} />);
    expect(container).toBeEmptyDOMElement();
    expect(updateBannerText(view({ catalogue: { lastOkAt: null, lastError: null } }))).toBeNull();
  });

  it('is silent when the only node behind has never been measured (measuredAt: null)', () => {
    // measuredAt is the ONLY field between this fleet row and an arrow: its
    // stamp was read (stampRead 'ok'), it runs v0.0.7 and desires v0.0.9 on
    // stable. A placeholder-shaped row (current null, stampRead 'absent') would
    // also be silenced by pendingTag's read-stamp guard, and would keep this
    // case green over a predicate that lost its measuredAt clause (Step 8, 7).
    const { container } = render(<UpdateBanner updates={view({
      nodes: [
        fleetNode({ measuredAt: null }),
        serverNode({ current: stamp('v0.0.9') }),
      ],
    })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is silent when the only node behind is a macOS node — not centrally managed, so it has no arrow', () => {
    // D-3309: pendingTag answers null for os 'darwin', so
    // this banner, BuildLine and the /settings row (which reads the macOS
    // sentence in place of a desired) say the same thing about the same node.
    const { container } = render(<UpdateBanner updates={view({
      nodes: [
        fleetNode({ os: 'darwin' }),
        serverNode({ current: stamp('v0.0.9') }),
      ],
    })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is silent when the only node behind has a channel this build cannot name (channel: null)', () => {
    const { container } = render(<UpdateBanner updates={view({
      nodes: [
        fleetNode({ channel: null, resolveDetail: 'the stored channel is not one this build can read' }),
        serverNode({ current: stamp('v0.0.9') }),
      ],
    })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is silent with no answer at all (updates={null})', () => {
    const { container } = render(<UpdateBanner updates={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('UpdateBanner — its two buttons', () => {
  it('renders Update all DISABLED, described by the one W3 sentence (spec §18 "the move controls are disabled in W3")', () => {
    render(<UpdateBanner updates={view()} />);
    const all = screen.getByRole('button', { name: 'Update all' });
    expect(all).toBeDisabled();
    expect(all).toHaveAccessibleDescription(MOVE_DISABLED_TEXT);
    expect(screen.getByText(MOVE_DISABLED_TEXT)).toBeInTheDocument();
  });

  it("See what's new lands on /settings", () => {
    render(<UpdateBanner updates={view()} />);
    fireEvent.click(screen.getByRole('button', { name: "See what's new" }));
    expect(location.pathname).toBe('/settings');
  });
});

describe('UpdateBanner — the FleetHostBanner idiom: injected, or self-polling', () => {
  it('never polls when the view is injected — FleetScreen polls once for the whole screen', () => {
    const updates = vi.spyOn(api, 'updates');
    render(<UpdateBanner updates={view()} />);
    render(<UpdateBanner updates={null} />);
    expect(updates).not.toHaveBeenCalled();
  });

  it('self-polls /api/updates when nothing is injected', async () => {
    vi.spyOn(api, 'updates').mockResolvedValue(view());
    render(<UpdateBanner />);
    expect(await screen.findByText('v0.0.9 is out on stable — fleet and server are on v0.0.7.')).toBeInTheDocument();
  });

  it('keeps the banner when a poll fails after a newer-release poll — a failure never clears the last good view', async () => {
    vi.useFakeTimers();
    try {
      const updates = vi.spyOn(api, 'updates')
        .mockResolvedValueOnce(view())
        .mockRejectedValueOnce(new Error('offline'));
      render(<UpdateBanner />);
      await act(async () => {});
      expect(screen.getByText('v0.0.9 is out on stable — fleet and server are on v0.0.7.')).toBeInTheDocument();
      await act(async () => { await vi.advanceTimersByTimeAsync(UPDATES_POLL_MS); });
      await act(async () => {});
      expect(updates).toHaveBeenCalledTimes(2);
      expect(screen.getByText('v0.0.9 is out on stable — fleet and server are on v0.0.7.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('UpdateBanner — a class of its own, a tap floor, and text only', () => {
  it('is self-grounded under its own class, never the fleet-host warn modifier', () => {
    render(<UpdateBanner updates={view()} />);
    expect(banner()!.className).toBe('update-banner');
    const rule = ruleIn(fleetCss, '.update-banner');
    expect(declValue(rule, 'background')).toBe('var(--accent-tint)');
    expect(declValue(rule, 'color')).toBe('var(--ink-primary)');
  });

  it('keeps the shared buttons at the tap floor: the banner override resizes their width, never their height', () => {
    expect(declValue(ruleIn(primitivesCss, '.btn-primary'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(primitivesCss, '.btn-ghost'), 'min-height')).toBe('var(--tap-min)');
    for (const sel of ['.update-banner-actions .btn-primary', '.update-banner-actions .btn-ghost']) {
      const rule = ruleIn(fleetCss, sel);
      expect(declValue(rule, 'width'), sel).toBe('auto');
      expect(declValue(rule, 'min-height'), sel).toBeNull();
      expect(declValue(rule, 'height'), sel).toBeNull();
    }
  });

  it('puts wire text into the DOM only as text children', () => {
    expect(bannerSrc).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
```

- [ ] **Step 2: Write the failing FleetScreen wiring cases**

First record the baseline: `cd pwa && npm ci && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx` — note the `Tests  N passed (N)` line (skip `npm ci` when `pwa/node_modules` is already present).

In `pwa/test/fleet-screen.test.tsx`, replace the import at `:4` in place (one line):

```tsx
import { SPAWN_STALL_MS, type FleetSession, type NodeWire, type ProjectPoolsWire, type ProjectRow, type RunSummary, type UpdatesView } from '../../shared/api';
```

Replace the file-level `beforeEach` (`:20-24`):

```tsx
beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
  FleetSocket.instances = [];
  // The screen's one /api/updates poll (UpdateBanner, centralised-update §13)
  // answers NOTHING by default, so no case here issues a real fetch for it and
  // no banner appears in a case that is not about one — a second status region
  // would make the mark-seen case's bare getByRole('status') (`:2246`) ambiguous. A case
  // about the banner re-spies with its own answer.
  vi.spyOn(api, 'updates').mockReturnValue(new Promise<UpdatesView>(() => {}));
});
```

In the `ticksOf` docstring, replace the three census lines

```tsx
   *  `useProjectedHome` (20_000), `AccountsStrip` (20_000 for its poll and
   *  30_000 for its own `useNow`), `FleetHostBanner` (15_000 + 30_000) and
   *  `HotFilesStrip` (30_000) all start polling from this screen's mount, and
```

with

```tsx
   *  `useProjectedHome` (20_000), `AccountsStrip` (20_000 for its poll and
   *  30_000 for its own `useNow`), `FleetHostBanner` (15_000 + 30_000),
   *  `useUpdatesView` (60_000 — the screen's one /api/updates poll, handed to
   *  UpdateBanner) and `HotFilesStrip` (30_000) all start polling from this
   *  screen's mount, and
```

Append after the file's last line — the closing `});` of Task 6's appended `describe('the door to /settings (centralised update management §13)', …)`:

```tsx

// ── centralised-update W3: the screen's one /api/updates poll ───────────────
//
// UpdateBanner is FleetHostBanner's idiom: the screen polls once and injects
// the answer. The count is the pin — a banner that self-polled beside the
// screen's own poll would be a second request per minute, and a second
// opinion about the inventory on one screen.

describe('the update banner on the fleet screen', () => {
  const stampOf = (version: string) => ({
    sha: 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', ref: 'main', builtAt: '2026-09-20T12:00:00Z', dirty: false, version,
  });
  const nodeOf = (nodeId: string, role: 'fleet' | 'server'): NodeWire => ({
    nodeId, role, label: role, os: 'linux',
    current: stampOf('v0.0.7'), stampRead: 'ok', installState: 'complete', provenance: 'verified',
    caps: ['update-gate'], agentOps: role === 'server' ? null : [], highestVersion: 'v0.0.7', previousVersion: null,
    measuredAt: Date.now() - MIN, reachable: true, unreachableSince: null,
    channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null,
    request: null, report: null,
    update: { state: 'idle', target: null, startedAt: null, detail: null },
  });
  const updatesNewer = (): UpdatesView => ({
    catalogue: { lastOkAt: Date.now() - 4 * MIN, lastError: null },
    releases: [],
    nodes: [
      nodeOf('0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10', 'fleet'),
      nodeOf('5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93', 'server'),
    ],
    intent: [],
  });

  it('polls /api/updates ONCE for the whole screen and hands the answer to UpdateBanner', async () => {
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(updatesNewer());
    render(<FleetScreen store={makeStore()} />);
    expect(await screen.findByText('v0.0.9 is out on stable — fleet and server are on v0.0.7.')).toBeInTheDocument();
    expect(updates).toHaveBeenCalledTimes(1);
  });

  it('shows no update banner while /api/updates has not answered', () => {
    render(<FleetScreen store={makeStore()} />);
    expect(document.querySelector('.update-banner')).toBeNull();
  });
});
```

- [ ] **Step 3: Run both files to verify they fail**

Run: `cd pwa && ./node_modules/.bin/vitest run test/update-banner.test.tsx`
Expected: FAIL — `Test Files  1 failed (1)` with `Error: Failed to resolve import "../src/fleet/UpdateBanner" from "test/update-banner.test.tsx". Does the file exist?` (no case runs).

Run: `cd pwa && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx`
Expected: FAIL — exactly one case red, "polls /api/updates ONCE for the whole screen and hands the answer to UpdateBanner", with `Unable to find an element with the text: v0.0.9 is out on stable — fleet and server are on v0.0.7.`; `Tests  1 failed | N+1 passed (N+2)`. "shows no update banner while /api/updates has not answered" is GREEN before the change — it is the control for the default stub, not a pin of the new code.

- [ ] **Step 4: Create `pwa/src/fleet/UpdateBanner.tsx`**

```tsx
// UpdateBanner — the fleet screen's "a release is out" line (centralised-update
// design 2026-09-20 §13; programme wave 3). One sentence and two buttons, over
// the answer FleetScreen's one /api/updates poll hands down. The sentence is
// `<tag> is out on <channel> — <summary>.`, the summary being versionsSummary's
// (shared/update-summary.ts) — the ONE spelling of what the nodes run, which
// the release push reads too; this file never restates it.
//
// It speaks iff the catalogue has been reached at least once since the server
// started (`catalogue.lastOkAt` is a number) AND some node's ONE arrow
// predicate (`pendingTag`, useUpdatesView.ts) names a tag. UNREACHABLE IS NOT
// CURRENT (§7, §18): a server that has never reached GitHub cannot know that
// nothing is newer, and a node that was never measured, or whose channel this
// build cannot name, has no arrow (nor does a macOS node, which this programme
// does not manage — decision 17) — so in each case the banner says nothing,
// never a calm "up to date" nobody measured. The settings screen is where the
// unknown is spelled out.
//
// THE FLEETHOSTBANNER IDIOM (FleetHostBanner.tsx): an injected prop (FleetScreen
// polls once and hands the view down), null when silent, a self-polling
// standalone shape for every other mount. role="status" like every banner on
// this screen — which is why it carries a class of its own, `.update-banner`,
// and never `.fleet-host-banner--warn`: a release being out is news, not a
// fault, and several status regions share this screen.
//
// "Update all" is DISABLED beside MOVE_DISABLED_TEXT: the apply route it would
// call does not exist in this wave (spec §13, §18 "the move controls are
// disabled in W3"). "See what's new" opens /settings, where the release list is.
import { useId } from 'react';
import type { ReactNode } from 'react';
import type { UpdateChannel, UpdatesView } from '../../../shared/api';
import { compareReleaseTags } from '../../../shared/semver';
import { versionsSummary } from '../../../shared/update-summary';
import { MOVE_DISABLED_TEXT } from '../lib/api';
import { navigate } from '../lib/router';
import { UPDATES_POLL_MS, nodeVersion, pendingTag, useUpdatesView } from './useUpdatesView';
import './fleet.css';

/** The release the banner announces: the NEWEST `pendingTag` across the
 *  inventory in semver order (`v0.0.10` above `v0.0.9` — string order has it
 *  the other way round), with the channel of the node that is behind it.
 *  `null` when the catalogue has never been reached since the server started,
 *  or when no node has an arrow. */
export function bannerRelease(view: UpdatesView): { tag: string; channel: UpdateChannel } | null {
  if (typeof view.catalogue.lastOkAt !== 'number') return null;
  if (!Array.isArray(view.nodes)) return null;
  let best: { tag: string; channel: UpdateChannel } | null = null;
  for (const n of view.nodes) {
    const tag = pendingTag(n);
    if (tag === null) continue;
    // pendingTag answers a tag only for a node whose channel is an
    // UpdateChannel (its contract). Restating that check here would be a
    // SECOND arrow predicate — one that keeps this banner green over a
    // pendingTag that lost its channel clause — so the type is asserted, not
    // re-derived.
    const channel = n.channel as UpdateChannel;
    if (best === null || compareReleaseTags(tag, best.tag) === 1) best = { tag, channel };
  }
  return best;
}

/** `${tag} is out on ${channel} — ${summary}.` over the MEASURED nodes only: a
 *  row nobody has measured has no version to report, and reading it as
 *  "unversioned" would state a measurement nobody made — versionsSummary says
 *  the side is missing instead. */
export function updateBannerText(view: UpdatesView): string | null {
  const release = bannerRelease(view);
  if (release === null) return null;
  const measured = view.nodes
    .filter((n) => typeof n.measuredAt === 'number')
    .map((n) => ({ role: n.role, version: nodeVersion(n) }));
  return `${release.tag} is out on ${release.channel} — ${versionsSummary(measured)}.`;
}

export function UpdateBanner({ updates: injected }: { updates?: UpdatesView | null } = {}): ReactNode {
  // Polls only when nothing was injected: FleetScreen polls once for the whole
  // screen; the standalone shape (tests, any other mount) still self-polls.
  const polled = useUpdatesView(injected === undefined ? UPDATES_POLL_MS : 0);
  const view = injected === undefined ? polled.view : injected;
  const noteId = useId();
  const text = view ? updateBannerText(view) : null;
  if (text === null) return null;
  return (
    <div className="update-banner" role="status">
      <span className="update-banner-msg">{text}</span>
      <div className="update-banner-actions">
        <button type="button" className="btn-ghost" disabled aria-describedby={noteId}>
          Update all
        </button>
        <button type="button" className="btn-primary" onClick={() => navigate('/settings')}>
          {"See what's new"}
        </button>
        <span id={noteId} className="update-banner-note">{MOVE_DISABLED_TEXT}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Append the banner's rules to `pwa/src/fleet/fleet.css`**

After the file's last line (`.hotfiles-path { … }`, `:2943` at `d759c914`, or whatever an earlier task of this wave appended after it):

```css

/* ── UpdateBanner (centralised-update design 2026-09-20 §13) ─────────────
   "vX is out on <channel>": news, not a fault, so it is neither the dead red
   nor the attention amber the fleet-host banner above uses for its three warn
   arms. Self-grounded on the preselected-row pair — --ink-primary on
   --accent-tint, 13.43:1 dark / 14.19:1 light (tokens.css) — so
   design/contrast-check.mjs measures it as a rule of its own and the children
   below set no colour of their own. No margin: it is a child of the .fleet
   column, whose padding is the gutter and whose gap is the spacing. Not
   sticky: the fleet-host banner owns the sticky slot, and two sticky banners
   would stack over the list. */
.update-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2) var(--sp-3);
  padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-4);
  border: 1px solid var(--accent);
  border-radius: var(--r-md);
  background: var(--accent-tint);
  color: var(--ink-primary);
  font: var(--weight-regular) var(--text-sm) / var(--leading-normal) var(--font-ui);
}
.update-banner-msg {
  flex-basis: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
}
.update-banner-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
}
/* The shared buttons are full-width sheet buttons (primitives.css); in a
   banner row they size to their label and keep their --tap-min height. */
.update-banner-actions .btn-primary,
.update-banner-actions .btn-ghost {
  flex: none;
  width: auto;
  padding: 0 var(--sp-3);
}
.update-banner-note {
  flex-basis: 100%;
  font-size: var(--text-xs);
}
```

- [ ] **Step 6: Wire the banner into `pwa/src/screens/FleetScreen.tsx`**

After the quoted import `import { useFleetHealth } from '../fleet/useFleetHealth';` add:

```tsx
import { UpdateBanner } from '../fleet/UpdateBanner';
import { useUpdatesView } from '../fleet/useUpdatesView';
```

Replace the quoted block

```tsx
  // One poll of /api/fleet/health feeds both the banner and BuildLine below
  // (spec §6) — the screen owns it so the two never issue their own requests.
  const fleetHealth = useFleetHealth();
```

with

```tsx
  // One poll of /api/fleet/health feeds both the banner and BuildLine below
  // (spec §6) — the screen owns it so the two never issue their own requests.
  // The same for /api/updates (centralised-update §13): ONE 60 s poll, its
  // view handed down to every reader of the inventory on this screen, none of
  // which polls on its own.
  const fleetHealth = useFleetHealth();
  const updates = useUpdatesView();
```

Replace the quoted line `      <FleetHostBanner health={fleetHealth} />` with:

```tsx
      <FleetHostBanner health={fleetHealth} />
      <UpdateBanner updates={updates.view} />
```

- [ ] **Step 7: Run green, then the neighbours and the gates**

Run: `cd pwa && ./node_modules/.bin/vitest run test/update-banner.test.tsx`
Expected: PASS — `Tests  20 passed (20)`.

Run: `cd pwa && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx`
Expected: PASS — `Tests  N+2 passed (N+2)`, N the baseline from Step 2 (a smaller green is not this green).

Run the other suites that mount `FleetScreen` or `<App/>` (each now issues `GET /api/updates` on mount; whatever their `fetch` stubs answer for it — a 404, another route's JSON, a rejection — is not an `UpdatesView` shape, so `asUpdatesView` refuses it and the banner stays silent, and none of them asserts on the whole list of requested URLs — measured: their `urls`/`mock.calls` reads are `some(...)`/`find(...)` over named routes) and the banner's neighbours:
`cd pwa && ./node_modules/.bin/vitest run test/fleet-host-banner.test.tsx test/build-line.test.tsx test/app.test.tsx test/app-pane-reset-timing.test.tsx test/auth-door.test.tsx test/auth-login.test.tsx test/fleet-class-chooser.test.tsx test/account-pool-chip.test.tsx test/coord-banner.test.tsx test/substrate-banner.test.tsx test/tap-targets.test.tsx test/session-line.test.tsx test/fleet-css.test.ts test/contrast.test.ts`
Expected: PASS, every file.

Run: `cd pwa && npm run build`
Expected: exit 0 (`tsc --noEmit` clean over `src` and `test`, then the vite build).

Run: `cd pwa && node design/contrast-check.mjs` → exit 0, `ALL <n> PASS`, with two new rows — `PASS   13.43  (min 4.5)  DARK  fleet.css .update-banner  var(--ink-primary) on var(--accent-tint)` and its `LIGHT` twin at 14.19 (a self-grounded rule is measured once per theme, as `.fleet-host-banner` is) — and `<n>` exactly two above the count this gate printed before this task; then `node design/contrast-check.mjs --uncovered | grep '^#   ' | grep -c update-banner` → prints `0` (the banner is self-grounded; its children set no colour). The `^#   ` filter is load-bearing: `--uncovered` prints the full PASS table first and the uncovered list after it as `#   <key>` lines, so an unfiltered `grep -c update-banner` counts the two PASS rows and prints `2` (measured on a copy of `pwa/` at `d759c914` with this step's CSS appended: `ALL 564 PASS` (562 before), the two rows at 13.43 DARK / 14.19 LIGHT, uncovered `255` before and after).

Run: `cd server && ./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts test/no-routing-keystroke-from-server.test.ts`
Expected: PASS — `single-definition` walks `pwa/src`, which gained a file (Task 3's one-holder case for the summary clause included: `UpdateBanner.tsx` does not spell it); `no-routing-keystroke-from-server` walks `pwa/src`; `topology-clean` scans the new files.

- [ ] **Step 8: Mutation check (spec §18 "unreachable is not current", "the move controls are disabled in W3")**

Each mutation is an Edit to the working file, one run, then the exact text re-typed back with the Edit tool — never `git checkout --`, which would also discard this task's uncommitted work.

1. §18 "unreachable is not current" (the banner surface): in `bannerRelease`, delete the line `  if (typeof view.catalogue.lastOkAt !== 'number') return null;`. Run `cd pwa && ./node_modules/.bin/vitest run test/update-banner.test.tsx` → RED: exactly "is silent while the catalogue has never been reached since the server started (lastOkAt: null)" (the container holds the banner). Restore the line exactly as deleted.
2. §18 "the move controls are disabled in W3": in `UpdateBanner`, change `<button type="button" className="btn-ghost" disabled aria-describedby={noteId}>` to `<button type="button" className="btn-ghost" aria-describedby={noteId}>`. Run the same file → RED: exactly "renders Update all DISABLED, described by the one W3 sentence …" (`toBeDisabled`). Restore `disabled`.
3. Tag order is semver: in `bannerRelease`, replace `compareReleaseTags(tag, best.tag) === 1` with `tag > best.tag`. Run the same file → RED: "picks the NEWEST pending tag in semver order — v0.0.10 over v0.0.9 …" (the banner reads `v0.0.9 is out on stable …`). Restore `compareReleaseTags(tag, best.tag) === 1`.
4. A never-measured row is not "unversioned": in `updateBannerText`, delete the line `    .filter((n) => typeof n.measuredAt === 'number')`. Run the same file → RED: exactly "reports a never-measured row as a MISSING side, not as an unversioned one" (the text reads `fleet unversioned · server v0.0.7`). Restore the line.
5. The last good view survives a failed poll (Review Focus 4, the banner end): in Task 5's `useUpdatesView` rejection arm, change `setState((prev) => ({ view: prev.view, failure }));` to `setState(() => ({ view: null, failure }));`. Run the same file → RED: exactly "keeps the banner when a poll fails after a newer-release poll …" (`Unable to find an element with the text`). Restore the line.
6. One poll per screen: in `FleetScreen.tsx`, replace `<UpdateBanner updates={updates.view} />` with `<UpdateBanner />`. Run `cd pwa && ./node_modules/.bin/vitest run test/fleet-screen.test.tsx` → RED: "polls /api/updates ONCE for the whole screen …" (`expected "spy" to be called 1 times, but got 2 times`). Restore `<UpdateBanner updates={updates.view} />`.
7. §18 "unreachable is not current" (the arrow predicate's `measuredAt` clause, on this surface): in `pendingTag` (`pwa/src/fleet/useUpdatesView.ts` — Task 5's file, not this task's), delete the line `  if (typeof n.measuredAt !== 'number') return null;`. Run `cd pwa && ./node_modules/.bin/vitest run test/update-banner.test.tsx` → RED: exactly "is silent when the only node behind has never been measured (measuredAt: null)" (the container holds `v0.0.9 is out on stable — fleet — · server v0.0.9.`). "reports a never-measured row as a MISSING side …" stays green: its placeholder row carries `stampRead: 'absent'`, which the read-stamp guard still silences — the confound this case's fixture was built to avoid. Restore the line exactly as deleted; `git diff --stat -- pwa/src/fleet/useUpdatesView.ts` prints nothing.
8. Decision 17 on this surface (D-3309): in `pendingTag`, delete the line `  if (n.os === 'darwin') return null;` (Task 9's). Run the same file → RED: exactly "is silent when the only node behind is a macOS node …" (the container holds `v0.0.9 is out on stable — fleet v0.0.7 · server v0.0.9.`). Restore the line; `git diff --stat -- pwa/src/fleet/useUpdatesView.ts` prints nothing.

Control: after the eighth restore, run `cd pwa && ./node_modules/.bin/vitest run test/update-banner.test.tsx test/fleet-screen.test.tsx test/use-updates-view.test.tsx` → PASS with the Step 7 counts (and Task 5's count for the hook file), so each red above was the mutation and nothing else; `git diff --stat` names exactly the five files of Step 9.

- [ ] **Step 9: Commit**

```bash
git add pwa/src/fleet/UpdateBanner.tsx pwa/src/screens/FleetScreen.tsx pwa/src/fleet/fleet.css pwa/test/update-banner.test.tsx pwa/test/fleet-screen.test.tsx
git commit -m "feat(update): UpdateBanner — 'vX is out on <channel>' on the fleet screen from its one /api/updates poll; silent while the catalogue is unreached or no measured node has an arrow; Update all disabled until W4"
```

### Task 12: BuildLine + FleetHostBanner onto `NodeWire[]`

**Files:**
- Modify: `pwa/src/fleet/BuildLine.tsx` — the whole file (36 lines at `d759c914`): the signature gains `nodes`; the sides come from the inventory through one new exported helper `remoteSides` (CORRECTED, see Interfaces); `side()` keeps its ONE `versioned` predicate (`:10-17`) and gains a third argument `next` for the affix
- Modify: `pwa/src/fleet/FleetHostBanner.tsx` — the header comment's BUILD SKEWED paragraph (`:17-22`), the signature (`:46`) and its polling comment (`:47-49`), and the skew arm's version clause (`:78-80`) read `nodes` through `remoteSides`, not the health route's stamp pair; the `import type { BuildInfo }` line (`:29`) is DELETED (its one use, `name`'s parameter, now takes a `NodeWire`; left in place it is an unused import, and `pwa/tsconfig.json` sets `noUnusedLocals`); the trigger `health.build === 'skewed'` (`:77`) and the arm order (roster > build > pools > unreachable) are unchanged (D-3312)
- Modify: `pwa/src/screens/FleetScreen.tsx` — the quoted `      <FleetHostBanner health={fleetHealth} />` (`:573` at `d759c914`; Task 11 put `<UpdateBanner updates={updates.view} />` directly under it) and the quoted `      <BuildLine health={fleetHealth} />` (`:932` at `d759c914`) — BOTH in this task (a partial move shows two disagreeing skew opinions on one screen). Anchored by QUOTED TEXT: Tasks 6 and 11 insert lines above both sites before this task runs. `updates` is Task 11's `const updates = useUpdatesView();`
- Modify: `pwa/src/fleet/fleet.css` — appended after its last line (whatever Tasks 6–11 appended after `:2943`): `.build-line-next` (amber, `--status-attention-text`, the `.build-line-side--warn` token, `fleet.css:336-338`)
- Modify: `pwa/design/audit.mjs` — one `INHERITED_GROUNDS` entry `'fleet.css .build-line-next'` inserted directly after the quoted `'fleet.css .build-line-side--warn': {` entry's closing `},` (`:742-745` at `d759c914`), `under: ['var(--bg-page)']`, the same reason. Anchored by QUOTED TEXT: Tasks 6–9 insert their entries directly before `INHERITED_GROUNDS`' closing `};`, i.e. AFTER this same entry, so at this task's run the new entry lands between `'fleet.css .build-line-side--warn'` and Task 6's first entry — the two build-line rules stay adjacent
- Test: `pwa/test/build-line.test.tsx` — REWRITTEN whole (47 lines at `d759c914`; 4 cases → 14): the `stamp(sha, version?, dirty)` and `remote(over)` helpers kept, the fixtures moved from `remote({builds})` to a `nodes` list, plus the literal-absence pin
- Test: `pwa/test/fleet-host-banner.test.tsx` — the three skew cases (`:180-212` at `d759c914`: "warns when the boxes run DIFFERENT builds …", "a skewed side with no version reads as unversioned …", "skewed from an OLDER server (no builds field) still warns …") REPLACED by five (CORRECTED: the skeleton said "re-fixtured"; two cases are added — the trigger pin and the `both`-row pin); the import block (`:9`) gains `NodeWire` and `BuildInfo`; every other case unchanged
- Test: `pwa/test/fleet-screen.test.tsx` — one describe APPENDED after the file's last line (after Task 11's `describe('the update banner on the fleet screen', …)`) (CORRECTION: the skeleton listed no fleet-screen case for this task, but the one fact this task exists for — both readers fed by the screen's ONE poll — is only visible at the screen)
- NOT edited: `shared/api.ts`'s `FleetHealth.builds` (`:3192`) and W2 Task 14's server derivation (`derivedBuilds`, `inventoryBuilds`) — the field stays on the wire, unread by the PWA (spec §14). No file the session-hook citation audit cites is touched (`shared/api.ts`, `single-definition.test.ts`, README), so R13 governs nothing here; no audit document cites a line of any file above (measured at `d759c914`: `git grep -nE "(BuildLine|FleetHostBanner|FleetScreen|build-line\.test|fleet-host-banner\.test|fleet-screen\.test|audit|fleet)\.(tsx?|mjs|css):[0-9]" -- README.md CLAUDE.md docs/superpowers/specs/2026-09-10-graphify-compaction-card-design.md docs/superpowers/plans/2026-09-10-graphify-compaction-card-plan-a.md` prints nothing)

**Interfaces:**
- Consumes: `NodeWire.role`, `NodeWire.current: BuildInfo | null` (W2 Task 1; `current` is `buildInfoOfRow(row)`, `null` unless `stampRead === 'ok'` — W2 Task 13's `toNodeWire`); Task 3's `versionSides<T extends { role: string | null }>(rows): { fleet: T | null; server: T | null }` (`shared/update-summary.ts` — server = the first `server`/`both` row; fleet = the first `fleet` row, else the server row when ITS role is `both`); Task 5's `pendingTag(n: NodeWire): string | null` (`pwa/src/fleet/useUpdatesView.ts`), AS CORRECTED BY TASK 9 (D-3307: its guard `if (n.stampRead !== 'ok') return null;` directly after the `isUpdateChannel` line — so a row whose stamp did not read, `current: null`, never draws an arrow, although `nodeVersion` answers null for it exactly as for an unversioned build; and D-3309: `if (n.os === 'darwin') return null;` directly after it — so a macOS row draws no arrow here either, as its `/settings` row reads `macOS: not centrally managed` and the update banner stays silent for it; BuildLine adds no OS clause of its own); Task 11's `updates: UpdatesPoll` in `FleetScreen`; `FleetHealth.mode`, `FleetHealth.connected`, `FleetHealth.build` (unchanged readers).
- Produces:

```tsx
// pwa/src/fleet/BuildLine.tsx
/** The two sides of a REMOTE fleet (D-3313): versionSides(nodes), except that a
 *  fleet side which IS the server row (versionSides' local-mode fallback for a lone `both` row) is null — on a
 *  remote fleet a `both` row is this box, never the fleet box (W2's derivedBuilds reads it the same way). */
export function remoteSides(nodes: readonly NodeWire[]): { fleet: NodeWire | null; server: NodeWire | null };
/** Local-mode suppression preserved: null when !health || health.mode !== 'remote'. On a remote fleet the line
 *  always stands: sides from remoteSides(nodes) when Array.isArray(nodes), else both null (no inventory answer —
 *  both sides render `—`, amber, no arrow). `fleet` then `server`, each side(label, row?.current ?? null, next)
 *  where next = row ? pendingTag(row) : null renders ` → ${next}` in span.build-line-next INSIDE the side's span;
 *  `dirty` is read `=== true`. */
export function BuildLine({ health, nodes }: { health: FleetHealth | null; nodes: readonly NodeWire[] | null }): ReactNode;

// pwa/src/fleet/FleetHostBanner.tsx
/** The skew arm's clause: ` fleet ${name(fleet)} · server ${name(server)}.` from remoteSides(nodes), where
 *  name(row) = `${row.current.version ?? 'unversioned'} (${row.current.sha.slice(0, 8)})` or '—' for no row/stamp;
 *  omitted when nodes is not an array (undefined — the standalone self-polling shape — or null — no answer yet).
 *  The standalone shape polls /api/fleet/health only; it never polls /api/updates. */
export function FleetHostBanner({ health, nodes }?: { health?: FleetHealth | null; nodes?: readonly NodeWire[] | null }): ReactNode;
```

- **Four corrections to the skeleton's interface, each found against the real code (2's second half and 4 are review fixes):**
  1. `remoteSides` is new (D-3313). Task 3's `versionSides` falls back to the server row for the fleet side when that row's role is `both` — right for the push body and the banner in local mode, where one box is both. `BuildLine` and the skew arm render only in REMOTE mode, where W2's `derivedBuilds` (which feeds `health.build`, this arm's trigger) reads a `both` row as the server side ONLY (`fleet: null`, W2 Task 14's "a 'both' row is this box" case). Without the guard, a remote server recorded as `both` with no fleet row yet would render "fleet v0.0.7 · server v0.0.7" — a fleet version nobody measured — beside a trigger computed without it. One helper, exported from `BuildLine.tsx` and imported by `FleetHostBanner.tsx`, so the two readers cannot disagree about which row is the fleet box.
  2. `BuildLine` guards `Array.isArray(nodes)`, not `nodes === null` (the Global Constraints' "every array read guards `Array.isArray`"): `null` and a malformed non-array both read as NO inventory — and no inventory does NOT hide the line (review fix, ux lens): both sides render unmeasured, `fleet — · server —` in amber with no arrow. Returning null there would take the build line off the phone exactly when the update plane is unreadable, where before this task it rendered from the health poll alone. An empty array renders the same dashes; both mean "no measured stamp for either box", and a dash claims no version.
  3. `FleetHostBanner`'s `BuildInfo` import is deleted (`noUnusedLocals`), and its standalone shape gets NO version clause — it self-polls health as before and does not start a second `/api/updates` poll; the only mount that passes `nodes` is `FleetScreen`.
  4. `side()` reads the wire boolean `dirty` once, as `b.dirty === true` (the Global Constraints' "every boolean is checked `=== true`"; review fix, tests-pwa lens): `NodeWire.current` reaches this component through `asUpdatesView`, which passes elements through unchecked (Task 5), so a non-boolean `dirty` must not render ` dirty` in amber. Behaviour for a well-formed stamp is unchanged.
- What changes in meaning, said once: `BuildLine` used to appear one `/api/fleet/health` answer after mount and to hide for a health answer with no stamp pair; it still appears one health answer after mount on a remote fleet, and now renders for a health answer with no stamp pair at all. Its VERSIONS come from `/api/updates` (one 60 s poll, whose first request goes out at mount): until that poll has a good answer — about one round trip normally, and for as long as it has none (a `5xx`, the network, a malformed body: Task 5's `view` stays null until the first good answer) — both sides read `—` in amber with no arrow. A server whose `/api/updates` answers `501 not-configured` (a hand-built `Deps` with no `coord` — the shipped server always opens one, `server/src/index.ts:66`) shows that dashed line. The PWA is served by its own server, so the "older server" case the old null-arm covered is not a pairing this bundle meets.
- The pinned affix: `fleet v0.0.7 → v0.0.9 · server v0.0.7 → v0.0.9` (the line's `textContent`, exactly); no arrow on a node with `measuredAt: null` or `channel: null`, nor on a row whose stamp did not read (`current: null`, Task 9's guard) even when it desires a tag, nor on a macOS row (`os: 'darwin'`, Task 9's second guard) beside a Linux row that keeps its arrow; an unversioned or dirty side stays `build-line-side--warn` exactly as today; `version: null` still renders amber `unversioned (bd2bf57a)` (the one-predicate regression guard); a non-boolean `dirty` (`'false'`) is not dirty; the affix's rule is `color: var(--status-attention-text)` (spec §13's "amber", read off `fleet.css` with `test/cssRule.ts`'s `declValue`/`ruleIn` exactly as Tasks 7 and 9 pin theirs — the contrast audit alone would pass a calm ink); null for `mode: 'local'` with a full `nodes` list; `fleet — · server —`, both amber, no arrow, for `nodes: null` or a non-array, even when the health answer carries a stamp pair.
- A literal-absence pin (in `build-line.test.tsx`): no file under `pwa/src` spells `.builds` (`/\.builds\b/`) — both readers moved, none left. Comments count: a comment in either component that names the field with a leading dot reds it, which is the point (a literal-absence pin is honest only while it is literal).
- Spec §18 rows pinned: "unreachable is not current" (the BuildLine surface — mutation: bypass `pendingTag` with a bare `desiredTag` → the `measuredAt: null` case reds), "a full `BuildInfo` round-trips" (the `dirty` side still renders ` dirty` from `NodeWire.current`). Spec §14's first bullet (the move) is pinned by the decoy cases (a health answer carrying a disagreeing stamp pair is never what renders) and by the absence pin.

- [ ] **Step 1: Record the baselines**

Run `test -d pwa/node_modules || (cd pwa && npm ci)` first (a workspace may carry `server/node_modules` only). Then, from `pwa/`, foreground:

```bash
./node_modules/.bin/vitest run test/build-line.test.tsx test/fleet-host-banner.test.tsx
./node_modules/.bin/vitest run test/fleet-screen.test.tsx
```
Expected: PASS — `build-line.test.tsx` `4 passed (4)`, `fleet-host-banner.test.tsx` `18 passed (18)`; write down `fleet-screen.test.tsx`'s `Tests  F passed (F)` (Task 11 left it at its baseline + 2) — Step 7 compares against `F + 1`, and a smaller green is not the same green.

- [ ] **Step 2: Write the failing `build-line.test.tsx`**

Replace the whole of `pwa/test/build-line.test.tsx` with:

```tsx
// BuildLine — the always-visible one-liner at the foot of FleetScreen
// (release/rollout spec §6; centralised-update design 2026-09-20 §13/§14):
// which version each box runs, amber for unversioned/dirty, a dash for
// unknown, and — since W3 — an amber ` → vX` affix on a side whose node the
// inventory says should move up. It reads the node inventory (`NodeWire[]`,
// FleetScreen's one GET /api/updates poll), NOT the health route's stamp
// pair, which stays on the wire unread (§14). Nothing at all for local mode
// or for no health answer; with no inventory answer, both sides unmeasured.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FleetHealth, NodeWire } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
import { BuildLine } from '../src/fleet/BuildLine';
import { declValue, ruleIn } from './cssRule';

afterEach(cleanup);

const SHA_A = 'bd2bf57a' + '0'.repeat(32);
const SHA_B = '2985b9d1' + '0'.repeat(32);
const stamp = (sha: string, version?: string, dirty = false): BuildInfo =>
  ({ sha, ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty, ...(version ? { version } : {}) });
const remote = (over: Partial<FleetHealth> = {}): FleetHealth =>
  ({ mode: 'remote', connected: true, downSince: null, ...over });

/** A measured, reachable, stable-channel node whose desired tag is the one it
 *  runs — so no arrow, unless a case moves `desiredTag`. `current: null` is a
 *  row whose stamp did not read (W2's `toNodeWire` answers null unless ok). */
const node = (role: 'fleet' | 'server' | 'both', current: BuildInfo | null, over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: role === 'fleet' ? '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10' : '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93',
  role, label: role === 'fleet' ? 'fleet' : 'server', os: 'linux',
  current, stampRead: current === null ? 'absent' : 'ok', installState: 'complete', provenance: 'verified',
  caps: [], agentOps: role === 'fleet' ? [] : null, highestVersion: current?.version ?? null, previousVersion: null,
  measuredAt: 1_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: current?.version ?? null, resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});

const line = (): Element | null => document.querySelector('.build-line');

describe('BuildLine', () => {
  it('renders both versions when both nodes run a tagged release', () => {
    render(<BuildLine health={remote({ build: 'agreed' })}
      nodes={[node('fleet', stamp(SHA_A, 'v0.0.7')), node('server', stamp(SHA_A, 'v0.0.7'))]} />);
    expect(screen.getByRole('status')).toHaveTextContent('fleet v0.0.7 · server v0.0.7');
    expect(screen.queryByText(/unversioned/)).not.toBeInTheDocument();
    expect(document.querySelector('.build-line-next')).toBeNull();
  });

  it('renders an unversioned side amber with its short sha, and a dirty side amber — the full BuildInfo round-trips from NodeWire.current', () => {
    render(<BuildLine health={remote({ build: 'skewed' })}
      nodes={[node('fleet', stamp(SHA_A)), node('server', stamp(SHA_B, 'v0.0.9', true))]} />);
    expect(screen.getByText('fleet unversioned (bd2bf57a)')).toHaveClass('build-line-side--warn');
    expect(screen.getByText('server v0.0.9 dirty')).toHaveClass('build-line-side--warn');
  });

  it('reads dirty as a boolean — a non-boolean on the wire is not dirty', () => {
    // NodeWire.current reaches BuildLine through asUpdatesView, which passes
    // elements through unchecked (Task 5): every wire boolean is read === true.
    const odd = { ...stamp(SHA_A, 'v0.0.7'), dirty: 'false' as unknown as boolean };
    render(<BuildLine health={remote()} nodes={[node('fleet', odd), node('server', stamp(SHA_A, 'v0.0.7'))]} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 · server v0.0.7');
    expect(screen.getByText('fleet v0.0.7')).not.toHaveClass('build-line-side--warn');
  });

  it('reads a version that arrived as null as unversioned AND amber — one predicate, read twice', () => {
    // The regression BuildLine's own comment narrates: the name used `??` while
    // the amber flag tested `=== undefined`, so a null version rendered
    // "unversioned" in calm ink. Moving the source onto NodeWire must not bring
    // the two reads back.
    const nullVersion: BuildInfo = { ...stamp(SHA_A), version: null as unknown as string };
    render(<BuildLine health={remote()} nodes={[node('fleet', nullVersion), node('server', stamp(SHA_B, 'v0.0.9'))]} />);
    expect(screen.getByText('fleet unversioned (bd2bf57a)')).toHaveClass('build-line-side--warn');
  });

  it('renders a dash for a side with no row, and for a row whose stamp did not read — with no arrow even when a tag is desired', () => {
    const { rerender } = render(<BuildLine health={remote({ build: 'unknown' })} nodes={[node('server', stamp(SHA_B, 'v0.0.9'))]} />);
    expect(line()!.textContent).toBe('fleet — · server v0.0.9');
    // The unread row DESIRES v0.0.9: pendingTag's read-stamp guard (Task 9,
    // D-3307) is what keeps "fleet — → v0.0.9" off
    // the line — a stamp nobody read is not "behind".
    rerender(<BuildLine health={remote({ build: 'unknown' })}
      nodes={[node('fleet', null, { desiredTag: 'v0.0.9' }), node('server', stamp(SHA_B, 'v0.0.9'))]} />);
    expect(line()!.textContent).toBe('fleet — · server v0.0.9');
    expect(screen.getByText('fleet —')).toHaveClass('build-line-side--warn');
  });

  it('carries the affix — each side a newer desired tag points at, in amber (spec §13)', () => {
    const { rerender } = render(<BuildLine health={remote({ build: 'agreed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' }),
      node('server', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' }),
    ]} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 → v0.0.9 · server v0.0.7 → v0.0.9');
    const arrows = [...document.querySelectorAll('.build-line-next')].map((e) => e.textContent);
    expect(arrows).toEqual([' → v0.0.9', ' → v0.0.9']);
    // "Amber" is a claim about the stylesheet, not the DOM (vitest runs with
    // css: false): the affix's own rule names the attention ink. The contrast
    // audit only measures a ratio, so a calm ink that clears it passes there.
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'fleet', 'fleet.css'), 'utf8');
    expect(declValue(ruleIn(css, '.build-line-next'), 'color')).toBe('var(--status-attention-text)');
    // One side behind, one current: the affix is per node, never per line.
    rerender(<BuildLine health={remote({ build: 'skewed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' }),
      node('server', stamp(SHA_B, 'v0.0.9')),
    ]} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 → v0.0.9 · server v0.0.9');
  });

  it('compares tags as semver — v0.0.10 is newer than v0.0.9', () => {
    render(<BuildLine health={remote({ build: 'agreed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.9'), { desiredTag: 'v0.0.10' }),
      node('server', stamp(SHA_A, 'v0.0.9'), { desiredTag: 'v0.0.10' }),
    ]} />);
    expect(line()!.textContent).toBe('fleet v0.0.9 → v0.0.10 · server v0.0.9 → v0.0.10');
  });

  it('draws no arrow while a node is unmeasured or has no resolved channel — unreachable is not current (§18)', () => {
    render(<BuildLine health={remote({ build: 'agreed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9', measuredAt: null }),
      node('server', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9', channel: null }),
    ]} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 · server v0.0.7');
    expect(document.querySelector('.build-line-next')).toBeNull();
  });

  it('draws no arrow on a macOS node — not centrally managed, as its /settings row says (decision 17)', () => {
    // D-3309: pendingTag answers null for os 'darwin', so
    // this line, the update banner and the inventory row agree about the node.
    // The Linux side beside it is the control: it keeps its arrow.
    render(<BuildLine health={remote({ build: 'agreed' })} nodes={[
      node('fleet', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' }),
      node('server', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9', os: 'darwin' }),
    ]} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 → v0.0.9 · server v0.0.7');
  });

  it("reads the inventory, never the health route's stamp pair (§14)", () => {
    // A decoy pair on the health answer, disagreeing with the rows: the line
    // must say what the rows say. And a health answer carrying NO pair — the
    // shape that used to hide the line — renders from the rows all the same.
    const decoy = { fleet: stamp(SHA_B, 'v9.9.9'), own: stamp(SHA_B, 'v9.9.9') };
    const rows = [node('fleet', stamp(SHA_A, 'v0.0.7')), node('server', stamp(SHA_A, 'v0.0.7'))];
    const { rerender } = render(<BuildLine health={remote({ build: 'agreed', builds: decoy })} nodes={rows} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 · server v0.0.7');
    expect(screen.queryByText(/v9\.9\.9/)).not.toBeInTheDocument();
    rerender(<BuildLine health={remote({ build: 'agreed' })} nodes={rows} />);
    expect(line()!.textContent).toBe('fleet v0.0.7 · server v0.0.7');
  });

  it('on a remote fleet, a server row recorded as both is this box — never the fleet box', () => {
    // D-3313: versionSides' local-mode fallback
    // (a lone `both` row is both sides) must not name a fleet version nobody
    // measured beside a skew trigger computed without one.
    render(<BuildLine health={remote({ build: 'unknown' })} nodes={[node('both', stamp(SHA_A, 'v0.0.7'))]} />);
    expect(line()!.textContent).toBe('fleet — · server v0.0.7');
  });

  it('still stands on a remote fleet whose inventory has not been read — both sides unmeasured, no arrow', () => {
    // Before /api/updates answers, and for as long as it cannot be read (a
    // 5xx, the network, a malformed body): hiding the line would take "what
    // each box runs" off the phone exactly when the update plane is unreadable.
    // A dash claims no version — neither current nor behind (§18). And the
    // health answer's stamp pair is NOT a fallback: that is the old reader.
    const decoy = { fleet: stamp(SHA_B, 'v9.9.9'), own: stamp(SHA_B, 'v9.9.9') };
    const { rerender } = render(<BuildLine health={remote({ build: 'agreed', builds: decoy })} nodes={null} />);
    expect(line()!.textContent).toBe('fleet — · server —');
    expect(screen.getByText('fleet —')).toHaveClass('build-line-side--warn');
    expect(screen.getByText('server —')).toHaveClass('build-line-side--warn');
    expect(document.querySelector('.build-line-next')).toBeNull();
    // A malformed answer that is not an array reads the same: no row measured.
    rerender(<BuildLine health={remote({ build: 'agreed' })} nodes={{} as unknown as NodeWire[]} />);
    expect(line()!.textContent).toBe('fleet — · server —');
  });

  it('renders nothing in local mode or for a null health', () => {
    const rows = [node('fleet', stamp(SHA_A, 'v0.0.7')), node('server', stamp(SHA_B, 'v0.0.9'))];
    const { rerender } = render(<BuildLine health={null} nodes={rows} />);
    expect(line()).toBeNull();
    // Local mode with a FULL inventory — only the mode clause can be hiding the
    // line here, not the nodes clause.
    rerender(<BuildLine health={{ mode: 'local', connected: true, downSince: null, build: 'agreed' } as FleetHealth}
      nodes={[node('both', stamp(SHA_A, 'v0.0.7'), { desiredTag: 'v0.0.9' })]} />);
    expect(line()).toBeNull();
  });
});

describe('the move onto NodeWire[] is whole (centralised-update §14)', () => {
  it("no file under pwa/src reads the health route's stamp pair any more — both readers moved together", () => {
    // A LITERAL-absence pin, deliberately: the two readers were BuildLine and
    // FleetHostBanner's skew arm, and a partial move would show two skew
    // opinions on one screen (the stamp pair's, the inventory's). The field
    // stays on the wire (§14 retires it later, under wire discipline); what is
    // pinned is that nothing in this bundle reads it.
    const root = path.join(import.meta.dirname, '..', 'src');
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f));
    expect(files.length, 'the walk stopped seeing the tree').toBeGreaterThan(50);
    const readers = files
      .filter((f) => /\.builds\b/.test(readFileSync(path.join(root, f), 'utf8')))
      .map((f) => f.split(path.sep).join('/'))
      .sort();
    expect(readers).toEqual([]);
  });
});
```

- [ ] **Step 3: Write the failing `fleet-host-banner.test.tsx` cases**

Replace the import at `:9` (in place, one line):

```tsx
import type { FleetHealth } from '../../shared/api';
```

with

```tsx
import type { FleetHealth, NodeWire } from '../../shared/api';
import type { BuildInfo } from '../../shared/buildinfo';
```

Directly after the `POOLS_UNAVAILABLE_COPY` declaration (`:25-26`) and its blank line, insert:

```tsx
/** The skew arm's version clause reads the node inventory (centralised-update
 *  §14). A measured stable node; `current` null = a stamp that did not read. */
const inventoryNode = (role: 'fleet' | 'server' | 'both', current: BuildInfo | null): NodeWire => ({
  nodeId: role === 'fleet' ? '0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10' : '5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93',
  role, label: role === 'fleet' ? 'fleet' : 'server', os: 'linux',
  current, stampRead: current === null ? 'absent' : 'ok', installState: 'complete', provenance: 'verified',
  caps: [], agentOps: role === 'fleet' ? [] : null, highestVersion: current?.version ?? null, previousVersion: null,
  measuredAt: Date.now() - 60_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: current?.version ?? null, resolveDetail: null,
  request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
});
const FLEET_V7: BuildInfo = { sha: 'bd2bf57a8733883085b3c118911fc983dc441299', ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.7' };
const SERVER_V9: BuildInfo = { sha: '2985b9d1000000000000000000000000000000000', ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v0.0.9' };
/** A stamp pair on the HEALTH answer that disagrees with every inventory row:
 *  whatever renders from it is the old reader, not the new one. */
const DECOY_BUILDS = {
  fleet: { sha: '9'.repeat(40), ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v9.9.9' },
  own: { sha: '9'.repeat(40), ref: 'release', builtAt: '2026-09-18T00:00:00Z', dirty: false, version: 'v9.9.9' },
};
```

Replace the three cases from `  it('warns when the boxes run DIFFERENT builds, naming both versions and the verb (spec §6)', async () => {` through the closing `  });` of `  it('skewed from an OLDER server (no builds field) still warns, without versions', async () => {` (`:180-212` at `d759c914`) with:

```tsx
  it('warns when the boxes run DIFFERENT builds, naming both nodes\' versions from the inventory and the verb (spec §6, §14)', () => {
    render(<FleetHostBanner
      health={health({ connected: true, downSince: null, roster: 'agreed', build: 'skewed', builds: DECOY_BUILDS })}
      nodes={[inventoryNode('fleet', FLEET_V7), inventoryNode('server', SERVER_V9)]} />);
    expect(screen.getByText(/run different builds/i)).toBeInTheDocument();
    expect(screen.getByText(/fleet v0\.0\.7 \(bd2bf57a\)/)).toBeInTheDocument();
    expect(screen.getByText(/server v0\.0\.9 \(2985b9d1\)/)).toBeInTheDocument();
    expect(screen.queryByText(/v9\.9\.9/)).not.toBeInTheDocument();
    expect(screen.getByText(/ccrc rollout/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a skewed side with no version reads as unversioned (a deploy.sh stamp)', () => {
    const { version: _v, ...unversioned } = FLEET_V7;
    void _v;
    render(<FleetHostBanner health={health({ connected: true, downSince: null, build: 'skewed' })}
      nodes={[inventoryNode('fleet', unversioned), inventoryNode('server', SERVER_V9)]} />);
    expect(screen.getByText(/fleet unversioned \(bd2bf57a\)/)).toBeInTheDocument();
  });

  it('skewed with no inventory answer still warns, without versions — never from the health route\'s pair', () => {
    // `nodes` absent (the standalone shape) and `nodes: null` (FleetScreen
    // before /api/updates answers) both omit the clause; the decoy pair on the
    // health answer is NOT a fallback — reading it would be the old reader.
    const skewed = health({ connected: true, downSince: null, build: 'skewed', builds: DECOY_BUILDS });
    const { rerender } = render(<FleetHostBanner health={skewed} />);
    expect(screen.getByText(/run different builds/i)).toBeInTheDocument();
    expect(screen.queryByText(/v9\.9\.9/)).not.toBeInTheDocument();
    expect(screen.queryByText(/fleet —/)).not.toBeInTheDocument();
    rerender(<FleetHostBanner health={skewed} nodes={null} />);
    expect(screen.getByText(/run different builds/i)).toBeInTheDocument();
    expect(screen.queryByText(/v9\.9\.9/)).not.toBeInTheDocument();
  });

  it('the trigger is still the server\'s agreement word — disagreeing rows under an agreed health are silent', () => {
    // D-3312: the arm fires on `health.build`
    // (buildAgreement over sha + dirty, server-side). The PWA does not
    // recompute it from the rows — a second copy of the agreement rule.
    render(<FleetHostBanner health={health({ connected: true, downSince: null, build: 'agreed' })}
      nodes={[inventoryNode('fleet', FLEET_V7), inventoryNode('server', SERVER_V9)]} />);
    expect(screen.queryByText(/run different builds/i)).not.toBeInTheDocument();
  });

  it('names no fleet version off a server row recorded as both — on a remote fleet that row is this box', () => {
    // D-3313 — the same helper BuildLine reads.
    render(<FleetHostBanner health={health({ connected: true, downSince: null, build: 'skewed' })}
      nodes={[inventoryNode('both', SERVER_V9)]} />);
    expect(screen.getByText(/fleet — · server v0\.0\.9 \(2985b9d1\)\./)).toBeInTheDocument();
  });
```

- [ ] **Step 4: Write the failing FleetScreen case**

Append after the last line of `pwa/test/fleet-screen.test.tsx` (after Task 11's `describe('the update banner on the fleet screen', …)`):

```tsx

// ── centralised-update W3 Task 12: both skew readers on the screen's one poll ─
//
// BuildLine and FleetHostBanner's skew arm moved together from the health
// route's stamp pair onto NodeWire[] (spec §14). The pin is the SCREEN: both
// read the one /api/updates answer Task 11 threads down, and the health
// answer's decoy pair (v9.9.9) is never what either renders.

describe('BuildLine and the skew banner read the screen\'s one /api/updates poll', () => {
  const stampOf = (sha: string, version: string) => ({
    sha, ref: 'release', builtAt: '2026-09-20T12:00:00Z', dirty: false, version,
  });
  const rowOf = (nodeId: string, role: 'fleet' | 'server', sha: string, version: string, desiredTag: string): NodeWire => ({
    nodeId, role, label: role, os: 'linux',
    current: stampOf(sha, version), stampRead: 'ok', installState: 'complete', provenance: 'verified',
    caps: ['update-gate'], agentOps: role === 'server' ? null : [], highestVersion: version, previousVersion: null,
    measuredAt: Date.now() - MIN, reachable: true, unreachableSince: null,
    channel: 'stable', desiredTag, resolveDetail: null,
    request: null, report: null,
    update: { state: 'idle', target: null, startedAt: null, detail: null },
  });

  it('both readers name the inventory\'s versions, never the health route\'s pair', async () => {
    vi.spyOn(api, 'fleetHealth').mockResolvedValue({
      mode: 'remote', connected: true, downSince: null, roster: 'agreed', build: 'skewed',
      builds: { fleet: stampOf('9'.repeat(40), 'v9.9.9'), own: stampOf('9'.repeat(40), 'v9.9.9') },
    });
    const view: UpdatesView = {
      catalogue: { lastOkAt: Date.now() - 4 * MIN, lastError: null },
      releases: [],
      nodes: [
        rowOf('0b6e1c62-7a4f-4d0e-9c1a-3f2d5e8a9b10', 'fleet', 'bd2bf57a91c3e0d4f6a8b2c5e7d9f1a3b5c7e9d1', 'v0.0.7', 'v0.0.9'),
        rowOf('5f3a9d21-2c8b-4e6f-a1d7-8b0c4e2f6a93', 'server', '2985b9d1000000000000000000000000000000000', 'v0.0.9', 'v0.0.9'),
      ],
      intent: [],
    };
    const updates = vi.spyOn(api, 'updates').mockResolvedValue(view);
    render(<FleetScreen store={makeStore()} />);
    await waitFor(() =>
      expect(document.querySelector('.build-line')?.textContent).toBe('fleet v0.0.7 → v0.0.9 · server v0.0.9'));
    expect(screen.getByText(/run different builds/i)).toHaveTextContent('fleet v0.0.7 (bd2bf57a) · server v0.0.9 (2985b9d1).');
    expect(document.body.textContent).not.toContain('v9.9.9');
    expect(updates).toHaveBeenCalledTimes(1);
  });
});
```

(`MIN`, `makeStore`, `api`, `screen`, `waitFor` and `vi` are the file's own — `:34`, `:93`, `:6`, `:2`, `:1`; `NodeWire` and `UpdatesView` are in the import line Task 11 widened at `:4`.)

- [ ] **Step 5: Run the three files to verify they fail**

Run from `pwa/`, foreground:

`./node_modules/.bin/vitest run test/build-line.test.tsx`
Expected: FAIL — `Tests  13 failed | 1 passed (14)`. The old `BuildLine` ignores `nodes`: every case whose health carries no stamp pair renders nothing (`Unable to find role="status"`, or `Cannot read properties of null (reading 'textContent')`); "reads the inventory, never the health route's stamp pair" renders the decoy (`expected 'fleet v9.9.9 · server v9.9.9' to be 'fleet v0.0.7 · server v0.0.7'`), and so does "still stands on a remote fleet whose inventory has not been read" (`expected 'fleet v9.9.9 · server v9.9.9' to be 'fleet — · server —'`); the absence pin names both readers (`expected [ 'fleet/BuildLine.tsx', 'fleet/FleetHostBanner.tsx' ] to deeply equal []`) — the positive control that the scan sees what it is meant to see. "renders nothing in local mode or for a null health" is GREEN before the change — it is the control for the suppression arms, not a pin of the new code.

`./node_modules/.bin/vitest run test/fleet-host-banner.test.tsx`
Expected: FAIL — `Tests  4 failed | 16 passed (20)`: "naming both nodes' versions from the inventory" (the old arm names `v9.9.9 (99999999)` from the decoy: `Unable to find an element with the text: /fleet v0\.0\.7 \(bd2bf57a\)/`), "a skewed side with no version reads as unversioned" (no pair on that health answer, so no clause), "skewed with no inventory answer still warns … never from the health route's pair" (the decoy clause renders: `expected <span …> not to be in the document`), and "names no fleet version off a server row recorded as both". "the trigger is still the server's agreement word" is GREEN before — the old arm never looked at rows either; it is the control that the new code keeps it that way (Step 8, M5).

`./node_modules/.bin/vitest run test/fleet-screen.test.tsx`
Expected: FAIL — `Tests  1 failed | F passed (F+1)`: "both readers name the inventory's versions, never the health route's pair" — the `waitFor` times out on `expected 'fleet v9.9.9 · server v9.9.9' to be 'fleet v0.0.7 → v0.0.9 · server v0.0.9'`.

- [ ] **Step 6: Implement**

Replace the whole of `pwa/src/fleet/BuildLine.tsx` with:

```tsx
import type { ReactNode } from 'react';
import type { FleetHealth, NodeWire } from '../../../shared/api';
import type { BuildInfo } from '../../../shared/buildinfo';
import { versionSides } from '../../../shared/update-summary';
import { pendingTag } from './useUpdatesView';
import './fleet.css';

/** "v0.0.7" / "unversioned (bd2bf57a)" / "—", plus " dirty"; amber unless
 *  the side is a clean, versioned release stamp. `next` is the tag the
 *  inventory says this node should move UP to (`pendingTag`), rendered as an
 *  amber " → v0.0.9" affix inside the side, or nothing. */
function side(label: string, b: BuildInfo | null, next: string | null): ReactNode {
  const affix = next === null ? null : <span className="build-line-next"> → {next}</span>;
  if (b === null) return <span className="build-line-side build-line-side--warn">{label} —{affix}</span>;
  // ONE predicate, read twice. The name used `??` (nullish: undefined AND
  // null) while the amber flag tested `=== undefined` alone, so a stamp
  // whose `version` arrived as null rendered "unversioned (…)" in calm
  // black — the line saying one thing and its colour saying the other, over
  // exactly the field this line exists to report.
  const versioned = typeof b.version === 'string';
  const name = versioned ? b.version : `unversioned (${b.sha.slice(0, 8)})`;
  // A wire boolean, read once and `=== true`: `current` reaches here through
  // asUpdatesView, which passes the rows through unchecked.
  const dirty = b.dirty === true;
  const warn = !versioned || dirty;
  return (
    <span className={`build-line-side${warn ? ' build-line-side--warn' : ''}`}>
      {label} {name}{dirty ? ' dirty' : ''}{affix}
    </span>
  );
}

/**
 * The two sides of a REMOTE fleet, read off the node inventory
 * (centralised-update design 2026-09-20 §14) — the ONE place BuildLine and
 * FleetHostBanner's skew arm learn which row is which box, so the two cannot
 * disagree on one screen.
 *
 * `versionSides` (shared/update-summary.ts) is the side picker; this adds one
 * rule (D-3313): a fleet side that IS the
 * server row — versionSides' fallback for a lone `both` row, which is right in
 * local mode, where one box is both — is NULL here. Both readers render only
 * on a remote fleet, where a `both` row is this box and never the fleet box;
 * the server's own agreement word (`health.build`, from W2's `derivedBuilds`)
 * reads that row the same way, so the names never contradict the trigger.
 */
export function remoteSides(nodes: readonly NodeWire[]): { fleet: NodeWire | null; server: NodeWire | null } {
  const { fleet, server } = versionSides(nodes);
  return { fleet: fleet === server ? null : fleet, server };
}

/** Always visible at the foot of FleetScreen (spec §6). Reads the node
 *  inventory FleetScreen's one /api/updates poll hands down (§14) — the
 *  health answer supplies the mode and nothing else. Renders nothing for
 *  local mode or for no health answer. */
export function BuildLine({ health, nodes }: { health: FleetHealth | null; nodes: readonly NodeWire[] | null }): ReactNode {
  if (!health || health.mode !== 'remote') return null;
  // No inventory answer — not yet, or not for as long as /api/updates cannot
  // be read (a 5xx, the network, a malformed body): the line still stands,
  // both sides a dash. Hiding it would take "what each box runs" away exactly
  // when the update plane is unreadable; a dash claims no version (§18).
  const { fleet, server } = Array.isArray(nodes) ? remoteSides(nodes) : { fleet: null, server: null };
  return (
    <div className="build-line" role="status">
      {side('fleet', fleet?.current ?? null, fleet ? pendingTag(fleet) : null)}
      <span className="build-line-sep"> · </span>
      {side('server', server?.current ?? null, server ? pendingTag(server) : null)}
    </div>
  );
}
```

In `pwa/src/fleet/FleetHostBanner.tsx`:

Replace the header comment's BUILD SKEWED paragraph (`:17-22`)

```tsx
//  - BUILD SKEWED (amber): the host is up, but the two boxes' `build.json`
//    stamps disagree (`buildAgreement`, server/src/fleetstate.ts). Names both
//    versions (or shas, for an unversioned deploy.sh stamp) when the server
//    reports them. No action button: the fix is `ccrc rollout`/`ccrc update`,
//    run from a terminal. `'unknown'` remains silent, same rule as the two
//    above.
```

with

```tsx
//  - BUILD SKEWED (amber): the host is up, but the two boxes' `build.json`
//    stamps disagree (`buildAgreement`, server/src/fleetstate.ts — the TRIGGER
//    stays that server-side word, D-3312). Names
//    both versions (or shas, for an unversioned deploy.sh stamp) from the node
//    inventory (`nodes`, FleetScreen's one /api/updates poll — centralised-
//    update §14; the same `remoteSides` BuildLine reads), and says nothing of
//    versions until that answer is in. No action button: the fix is `ccrc
//    rollout`/`ccrc update`, run from a terminal. `'unknown'` remains silent,
//    same rule as the two above.
```

Delete the line `import type { BuildInfo } from '../../../shared/buildinfo';` (`:29`), replace `import type { FleetHealth } from '../../../shared/api';` (`:28`) with `import type { FleetHealth, NodeWire } from '../../../shared/api';`, and add after `import { useFleetHealth } from './useFleetHealth';` (`:35`):

```tsx
import { remoteSides } from './BuildLine';
```

Replace the signature and its polling comment (`:46-49`)

```tsx
export function FleetHostBanner({ health: injected }: { health?: FleetHealth | null } = {}): ReactNode {
  // Polls only when nothing was injected: FleetScreen polls once for this
  // banner and BuildLine together; the standalone shape (tests, other
  // screens) still self-polls.
```

with

```tsx
export function FleetHostBanner(
  { health: injected, nodes }: { health?: FleetHealth | null; nodes?: readonly NodeWire[] | null } = {},
): ReactNode {
  // Polls only when nothing was injected: FleetScreen polls once for this
  // banner and BuildLine together; the standalone shape (tests, other
  // screens) still self-polls the HEALTH route. It never polls /api/updates:
  // without `nodes` the skew arm names no versions, which is also what it
  // says while FleetScreen's inventory poll has not answered.
```

Replace the skew arm's two clause lines (`:78-80`)

```tsx
    const name = (b: BuildInfo | null | undefined): string =>
      b ? `${b.version ?? 'unversioned'} (${b.sha.slice(0, 8)})` : '—';
    const fleet = health.builds ? ` fleet ${name(health.builds.fleet)} · server ${name(health.builds.own)}.` : '';
```

with

```tsx
    const name = (row: NodeWire | null): string => {
      const b = row?.current ?? null;
      return b ? `${b.version ?? 'unversioned'} (${b.sha.slice(0, 8)})` : '—';
    };
    const sides = Array.isArray(nodes) ? remoteSides(nodes) : null;
    const fleet = sides ? ` fleet ${name(sides.fleet)} · server ${name(sides.server)}.` : '';
```

(the JSX below it, `The two boxes run different builds.{fleet} …`, is unchanged).

In `pwa/src/screens/FleetScreen.tsx`, replace the quoted line `      <FleetHostBanner health={fleetHealth} />` with:

```tsx
      <FleetHostBanner health={fleetHealth} nodes={updates.view?.nodes ?? null} />
```

and the quoted line `      <BuildLine health={fleetHealth} />` with:

```tsx
      <BuildLine health={fleetHealth} nodes={updates.view?.nodes ?? null} />
```

Append after the last line of `pwa/src/fleet/fleet.css`:

```css

/* BuildLine's affix (centralised-update design 2026-09-20 §13): " → v0.0.9"
 * after a side whose node the inventory says should move up (`pendingTag`).
 * Amber like the warn side — something to do, not a fault — and a rule of its
 * own, so the contrast audit measures it (audit.mjs INHERITED_GROUNDS). */
.build-line-next {
  color: var(--status-attention-text);
}
```

In `pwa/design/audit.mjs`, directly after the `'fleet.css .build-line-side--warn': { … },` entry (its closing `},` at `:745` at `d759c914`), insert:

```js
  'fleet.css .build-line-next': {
    under: ['var(--bg-page)'],
    why: "centralised-update W3 Task 12: BuildLine's ' → vX' affix, a span inside a .build-line-side span inside .build-line, the last child of FleetScreen's own <main class=\"fleet\"> — no ancestor between it and the app shell paints a background, so its ground is --bg-page, the same as the two build-line rules above. Its selector names no painted ancestor, so the auditor cannot recover that ground from CSS alone.",
  },
```

- [ ] **Step 7: Run green, then the neighbours and the gates**

From `pwa/`, foreground:

`./node_modules/.bin/vitest run test/build-line.test.tsx test/fleet-host-banner.test.tsx`
Expected: PASS — `build-line.test.tsx` `14 passed (14)`, `fleet-host-banner.test.tsx` `20 passed (20)` (18 at the baseline − 3 replaced + 5).

`./node_modules/.bin/vitest run test/fleet-screen.test.tsx`
Expected: PASS — `Tests  F+1 passed (F+1)`, `F` from Step 1.

`./node_modules/.bin/vitest run test/update-banner.test.tsx test/use-updates-view.test.tsx test/substrate-banner.test.tsx test/auth-door.test.tsx test/elapsed.test.ts test/app.test.tsx test/fleet-css.test.ts test/contrast.test.ts`
Expected: PASS, every file — the neighbours that mount `FleetScreen`/`FleetHostBanner` or read `fleet.css`/`audit.mjs`; `contrast.test.ts`'s "the uncovered census … contains no identities beyond the grandfathered blind spots" is the one that sees the new rule.

`npm run build`
Expected: exit 0 — `tsc --noEmit` clean over `src` and `test` (no unused `BuildInfo` import in `FleetHostBanner.tsx`; `remoteSides`' explicit return type holds under `Array.isArray`'s narrowing), then the vite build.

`node design/contrast-check.mjs`
Expected: exit 0, no FAIL row. Then `node design/contrast-check.mjs --uncovered | grep '^#   ' | grep -c build-line-next` → `0` (registered, so measured, not uncovered). The `^#   ` filter is load-bearing: `--uncovered` prints the full PASS table first and the uncovered census after it as `#   <key>` lines, so an unfiltered `grep -c build-line-next` counts the rule's two PASS rows (`DARK` and `LIGHT`, `var(--status-attention-text) on var(--bg-page)`) and prints `2` — which is the positive evidence the rule is measured (measured at `d759c914` on its sibling: `grep -c build-line-side--warn` → `2`, `grep '^#   ' | grep -c build-line-side--warn` → `0`).

`./node_modules/.bin/vitest run`
Expected: PASS — the whole pwa suite (a component's prop change reaches every mount; no suite list is enough).

From `server/`: `./node_modules/.bin/vitest run test/single-definition.test.ts test/topology-clean.test.ts`
Expected: PASS — `single-definition` walks `pwa/src` (`remoteSides` restates no W2 vocabulary and no SQL tuple); `topology-clean` scans the changed files (the test fixtures carry shas and UUIDs, no hostname, username or address).

- [ ] **Step 8: Mutation measurements (restore after each with the Edit tool — never `git checkout --`, which would discard this task's uncommitted work)**

After the last restore, `git diff --stat` names exactly the eight files of Step 9, and Step 7's first two commands are green again with the Step 7 counts — the control that each red below was its mutation and nothing else.

1. **M1 — §18 "unreachable is not current" (the BuildLine surface).** In `BuildLine`, replace `fleet ? pendingTag(fleet) : null` with `fleet?.desiredTag ?? null` and `server ? pendingTag(server) : null` with `server?.desiredTag ?? null` (a bare desired tag, bypassing the one arrow predicate). Run `./node_modules/.bin/vitest run test/build-line.test.tsx` → RED: "draws no arrow while a node is unmeasured or has no resolved channel" (`expected 'fleet v0.0.7 → v0.0.9 · server v0.0.7 → v0.0.9' to be 'fleet v0.0.7 · server v0.0.7'`), and with it every case whose desired tag equals its current ("renders both versions …" finds a `.build-line-next`) and "renders a dash … with no arrow even when a tag is desired" (its first assertion: `expected 'fleet — · server v0.0.9 → v0.0.9' to be 'fleet — · server v0.0.9'`), and "draws no arrow on a macOS node" (`expected 'fleet v0.0.7 → v0.0.9 · server v0.0.7 → v0.0.9' to be 'fleet v0.0.7 → v0.0.9 · server v0.0.7'`). Restore both expressions.
2. **M2 — §14, the move is whole.** Insert the line `  void health.builds;` directly after BuildLine's `if (!health || health.mode !== 'remote') return null;`. Run the same file `-t 'moved together'` → RED: `expected [ 'fleet/BuildLine.tsx' ] to deeply equal []`. Delete the line.
3. **M3 — the screen hands the one poll to BuildLine.** In `FleetScreen.tsx`, replace `<BuildLine health={fleetHealth} nodes={updates.view?.nodes ?? null} />` with `<BuildLine health={fleetHealth} nodes={null} />`. Run `./node_modules/.bin/vitest run test/fleet-screen.test.tsx -t 'both readers'` → RED: the `waitFor` times out (`expected 'fleet — · server —' to be 'fleet v0.0.7 → v0.0.9 · server v0.0.9'` — the line stands, unmeasured, since no inventory reached it). Restore. Then replace `<FleetHostBanner health={fleetHealth} nodes={updates.view?.nodes ?? null} />` with `<FleetHostBanner health={fleetHealth} />` → the same case RED on `toHaveTextContent('fleet v0.0.7 (bd2bf57a) · server v0.0.9 (2985b9d1).')`. Restore.
4. **M4 — the one-predicate regression guard.** In `side()`, replace `const warn = !versioned || dirty;` with `const warn = b.version === undefined || dirty;`. Run `test/build-line.test.tsx -t 'arrived as null'` → RED: `expected <span class="build-line-side"> to have class "build-line-side--warn"`. Restore.
5. **M5 — D-3312.** In `FleetHostBanner`, replace the skew condition `health.build === 'skewed'` with `(health.build === 'skewed' || (Array.isArray(nodes) && new Set(nodes.map((n) => n.current?.sha)).size > 1))` (the PWA recomputing agreement from the rows). Run `test/fleet-host-banner.test.tsx -t 'agreement word'` → RED: `expected <span class="fleet-host-banner-msg"> not to be in the document`. Restore `health.build === 'skewed'`.
6. **M6 — D-3313.** In `remoteSides`, replace `return { fleet: fleet === server ? null : fleet, server };` with `return { fleet, server };`. Run `test/build-line.test.tsx test/fleet-host-banner.test.tsx -t 'both'` → RED twice: BuildLine's "a server row recorded as both is this box" (`expected 'fleet v0.0.7 · server v0.0.7' to be 'fleet — · server v0.0.7'`) and the banner's "names no fleet version off a server row recorded as both". Restore.
7. **M7 — local-mode suppression.** In `BuildLine`, replace the guard `if (!health || health.mode !== 'remote') return null;` with `if (!health) return null;`. Run `test/build-line.test.tsx -t 'local mode'` → RED: `expected <div class="build-line" role="status"> to be null`. Restore.
8. **M8 — the contrast registration.** Delete the `'fleet.css .build-line-next': { … },` entry from `INHERITED_GROUNDS`. Run `./node_modules/.bin/vitest run test/contrast.test.ts -t 'grandfathered'` → RED: `expected [ 'fleet.css .build-line-next' ] to deeply equal []`; and `node design/contrast-check.mjs --uncovered | grep -c build-line-next` → `1`. Restore the entry.
9. **M9 — Task 9's read-stamp guard reaches this surface.** In `pendingTag` (`pwa/src/fleet/useUpdatesView.ts` — not one of this task's files; restore it before the control), delete the line `  if (n.stampRead !== 'ok') return null;`. Run `./node_modules/.bin/vitest run test/build-line.test.tsx -t 'stamp did not read'` → RED: `expected 'fleet — → v0.0.9 · server v0.0.9' to be 'fleet — · server v0.0.9'`. Re-insert the line; `git diff --stat -- pwa/src/fleet/useUpdatesView.ts` prints nothing.
10. **M10 — `dirty` is read `=== true`.** In `side()`, replace `const dirty = b.dirty === true;` with `const dirty = Boolean(b.dirty);`. Run `test/build-line.test.tsx -t 'reads dirty as a boolean'` → RED: `expected 'fleet v0.0.7 dirty · server v0.0.7' to be 'fleet v0.0.7 · server v0.0.7'`. Restore.
11. **M11 — the affix is amber (spec §13).** In `fleet.css`, inside the `.build-line-next { … }` rule only (the file's last rule — `color: var(--status-attention-text);` also appears in `.build-line-side--warn`, so match the selector line with it), replace `color: var(--status-attention-text);` with `color: var(--ink-tertiary);` (the line's own calm ink, which clears 4.5:1 on `--bg-page` in both themes — `.build-line` measures `6.23` DARK, `5.25` LIGHT at `d759c914`). Run `test/build-line.test.tsx -t 'carries the affix'` → RED: `expected 'var(--ink-tertiary)' to be 'var(--status-attention-text)'`. Then `node design/contrast-check.mjs` → still exit 0, no FAIL row — the control that the contrast audit alone cannot see which colour the rule names. Restore.
12. **M12 — the line stands without an inventory.** In `BuildLine`, replace the guard `if (!health || health.mode !== 'remote') return null;` with `if (!health || health.mode !== 'remote' || !Array.isArray(nodes)) return null;` (hiding the line when `/api/updates` is unread). Run `test/build-line.test.tsx -t 'has not been read'` → RED: `Cannot read properties of null (reading 'textContent')`. Restore.
13. **M13 — Task 9's Darwin guard reaches this surface (D-3309).** In `pendingTag` (`pwa/src/fleet/useUpdatesView.ts` — not one of this task's files; restore it before the control), delete the line `  if (n.os === 'darwin') return null;`. Run `./node_modules/.bin/vitest run test/build-line.test.tsx -t 'macOS node'` → RED: `expected 'fleet v0.0.7 → v0.0.9 · server v0.0.7 → v0.0.9' to be 'fleet v0.0.7 → v0.0.9 · server v0.0.7'`. Re-insert the line; `git diff --stat -- pwa/src/fleet/useUpdatesView.ts` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add pwa/src/fleet/BuildLine.tsx pwa/src/fleet/FleetHostBanner.tsx pwa/src/screens/FleetScreen.tsx pwa/src/fleet/fleet.css pwa/design/audit.mjs pwa/test/build-line.test.tsx pwa/test/fleet-host-banner.test.tsx pwa/test/fleet-screen.test.tsx
git commit -m "feat(update): BuildLine and the skew banner read NodeWire[] together — the arrow affix from pendingTag, one remoteSides for both, the health route's stamp pair left on the wire unread"
```

### Task 13: Docs, gate, PR

**Files:**
- Modify: `README.md` — two edits in the Releases section, both anchored by W2's QUOTED text (W2 Task 15 wrote the paragraph; README is W2-changed, so no line number is given): (a) the LAST THREE LINES of W2's "**Control plane (update-management W2).**" paragraph, whose "Not yet:" sentence names "no release notification, no settings screen" — false once this wave merges — are replaced by exactly three lines (line-neutral); (b) one new paragraph, "**Settings, the update banner and release pushes (update-management W3).**", inserted after W2's paragraph and its blank line, before `**The maintenance verbs.**` — the Settings screen (`/settings`, reached by the fleet header's Settings door; channel, auto-install, release notifications; the catalogue line; release list and inventory; move controls disabled until W4), the `UpdateBanner`, the `BuildLine` arrow, and release notifications (once per tag, across restarts; a tag the fleet already runs is marked, not pushed; the tap opens `/settings`). No `file:line` token and no `:<digits>` token anywhere (the README citation census stays empty — `session-hook.test.ts`'s `REF_RE` (`:7080` at `d759c914`) makes the file part OPTIONAL, so even a bare clock time such as `14:02` is a citation it tries to resolve); NOT line-neutral, deliberately — `pools-prose.test.ts`'s size ratchet (`:868-880`) is re-measured in Step 3
- Modify: `CLAUDE.md` — only if a rule changed. None is expected (this wave adds no route, no credential, no gate, no doctrine; W2's Deploy-bullet sentence naming `GET /api/updates` stays true), so the only possible edit is the README size claim on `CLAUDE.md:10`, and only if Step 3's measurement moves it; if CLAUDE.md is unchanged, the PR body says so and why
- NOT edited by this task: `docs/superpowers/plans/2026-09-23-centralised-update-w3-settings-and-notification.md` — the coordinator replaces every «dev:…» placeholder, in prose and in code-block comments, with an allocator-issued number in one pass (ruling R12); Step 5 only verifies it happened and never types a number
- Guard files READ by this task's edits and run in Step 4, none edited: `server/test/pools-prose.test.ts` (the size ratchet; its README passages open on markers this paragraph does not contain), `server/test/oss-metadata.test.ts` (the same claim at 10%, `:89-100`), `server/test/session-hook.test.ts` (README's citation-census entry stays empty), `server/test/box-token-census.test.ts`, `server/test/coord-pause-route.test.ts`, `server/test/crossrepo-prose.test.ts`, `server/test/readme-holds.test.ts`, `server/test/readme-roster-mirror.test.ts` (README by passage marker — none of their markers is in, or copied into, the Releases section), `server/test/ccrc-update.test.ts` (reads README whole for the bash floor sentence, which this task does not touch), `server/test/license.test.ts` (README's License section), `server/test/ccrc-install-graphify.test.ts` (README's graphify step-count sentence, whitespace-flattened), `server/test/worker-skill.test.ts`, `server/test/reviewer-skill.test.ts` and `server/test/coordinator-skill.test.ts` (README and CLAUDE.md name each skill by path with its clause count — the new text names no skill), `server/test/ledger-instruction.test.ts` (CLAUDE.md's ledger bullet by marker — owed only if Step 3 edits CLAUDE.md, run regardless), `server/test/topology-clean.test.ts` (correction: the earlier list omitted five whole-README readers that `grep -l README server/test/*.ts` lists at `d759c914` — its other hits are fixture files, name strings or comments, none reading the repo's README — and `ledger-instruction`, W2 Task 15's CLAUDE.md reader; none is threatened by this text, but a guard list that omits a reader of an edited file is not the census it claims to be)
- Run: `cd pwa && npm ci && ./node_modules/.bin/vitest run` (the whole pwa suite, foreground) and `npm run build`; `cd server && ./node_modules/.bin/vitest run` (the whole server suite; four foreground batches if the unsharded run is killed) and `./node_modules/.bin/tsc --noEmit`; `cd agent && ./node_modules/.bin/vitest run` and `./node_modules/.bin/tsc --noEmit` (CI's `Typecheck` step runs `tsc --noEmit` in every package after its suite, `.github/workflows/ci.yml:127-129`; server's `tsconfig.json` includes `src` and `../shared` only, so a Task 1–3 type error in `server/src` is caught by that step, not by the suite — correction: the earlier Run line had no server or agent typecheck); `cd pwa && node design/contrast-check.mjs` and `node design/contrast-check.mjs --uncovered` (no new selector in the uncovered census); `cd server && ./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts test/session-hook.test.ts test/single-definition.test.ts`
- The PR: title `feat(update): W3 — /settings, the update banner, release push`; body lists the thirteen tasks, the departures by their minted numbers (the coordinator's pass lands before the PR opens — Step 5), the measured suite counts, and the exit criterion as the coordinator's live act

**Interfaces:**
- Consumes: every task above; W2's merged `README.md` paragraph (W2 Task 15 Step 1); `git fetch origin main` before the gate (a merge-ref re-run tests the merge, not the base).
- Produces: one PR on the workspace branch; no code of its own. The fixture proofs that stand in for the live exit criterion, named by file in the wave-done (Step 9), and the coordinator's live-measurement list (Step 10).
- The live exit criterion (spec §15 row W3), the coordinator's after rollout: the operator sees the banner on the phone within one poll (≤ 60 s) of a merge whose release the catalogue lists, and switches channel from the screen — `GET /api/updates`' `intent[]` `'*'` row reads the new channel and the server's `~/.ccrc/update-intent` projection names it.

- [ ] **Step 1: Precondition — W2 is on `main`, and this branch is on top of it**

```bash
git fetch origin main
git grep -c 'export interface UpdatesView' origin/main -- shared/api.ts
git grep -c 'Control plane (update-management W2)' origin/main -- README.md
git merge-base --is-ancestor origin/main HEAD && echo up-to-date || echo behind
```
Expected: `origin/main:shared/api.ts:1`, `origin/main:README.md:1`, `up-to-date`. A `0` on either grep means W2 has not merged — STOP and report to the coordinator (every task here codes against W2's names). `behind` means `main` moved while this wave ran: `git merge origin/main` (never a rebase — the workspace branch is bound to its PR by its tip), resolve, and re-run Steps 4 and 6 on the merged tree; a merge is a tree nobody ran until they are green.

- [ ] **Step 2: README — correct W2's "Not yet", then the W3 paragraph**

(a) In `README.md`, replace the last three lines of the "**Control plane (update-management W2).**" paragraph —

```markdown
`/api/fleet/health`'s `builds` is now a view of the inventory rows. Not yet: no apply or rollback route, no
fleet-side projection reader, no release notification, no settings screen — and an `auto` other than `off` is
refused (`409`) until every node the intent covers lists `update-gate` in its `ccrc-caps`.
```

— with exactly three lines:

```markdown
`/api/fleet/health`'s `builds` is a view of the inventory rows, and the PWA no longer reads it. Not yet: no
apply or rollback route and no fleet-side projection reader — and an `auto` other than `off` is refused
(`409`) until every node the intent covers lists `update-gate` in its `ccrc-caps`.
```

If W2's merged paragraph does not end in those three lines (a W2 review round reworded it), edit what merged: remove exactly the two "Not yet" items this wave ships ("no release notification", "no settings screen"), say that the PWA no longer reads `builds`, and keep the line count of the lines you touch — then say so in the wave-done.

(b) Directly after that paragraph's last line and its blank line, before `**The maintenance verbs.**`, insert this paragraph followed by one blank line:

```markdown
**Settings, the update banner and release pushes (update-management W3).** The fleet header's **Settings** door
opens `/settings`, which reads `GET /api/updates` once a minute and whenever the page is shown again. Updates:
the fleet's channel (stable or dev); auto-install (off, stable releases only, every release on my channel —
disabled, naming the nodes, until every node lists `update-gate`); **Check now** (`POST /api/updates/refresh`);
and the catalogue line — how long ago GitHub was last reached, amber with the reason when it could not be,
`never checked` until the server's first poll since it started, and never "up to date" while nothing was
reached. Then the release list (newest first by version; `verified` only when a node runs that tag and its
bundle verified — a listed bundle alone reads `bundle listed`; notes as plain text, never markup) and the node
inventory (what each node runs and should run, its request and its state; **Ack** returns a settled node to idle
and clears its request and refusals). Every control that would move a node — Install, Roll back, Update, Update
all — is shown disabled until the next release. A red banner warns when the sign-in gate is off and the page was
reached over a non-loopback address. On the fleet screen an update banner (`vX is out on <channel> — …`, with a
door to `/settings`) and a `→ vX` on that node's side of `BuildLine` appear while a measured node with a channel
has a newer desired tag; the banner also waits until GitHub has answered since the server started. A `server` or
`both` box sends at most one Web Push per release tag, for the newest tag its release-notification setting (on
my channel, stable only, off) selects, recorded in `coord.db` before it is sent: a restart never repeats it, a
failed send is not retried, and a tag every measured node already runs is recorded without a push. It has no
session, so an open app does not suppress it; tapping it opens `/settings`.
```

Constraints this text was written to (re-check them if you reword it): no `file:line` anchor and no `:<digits>` token (no colon in the text is followed by a digit, and there is no clock time); none of the passage markers other suites slice README by (`box-token-census.test.ts`, `pools-prose.test.ts`, `crossrepo-prose.test.ts` — e.g. "What is gated, and what is not:", "**Caps and pause.**", "Pause is a"), because `passage()` takes the FIRST occurrence of its `from` marker and a copy here would move the slice; no hostname, org, account label or address (`topology-clean.test.ts`). The facts are the producers', each checked against the task that ships it: the door and its label (Task 6); `UPDATES_POLL_MS = 60_000` and the visibility refresh (Task 5); `CHANNEL_SENTENCES`, `AUTO_LABELS`, `autoGateMissing` and `UPDATE_GATE_CAP` (Task 7); the three catalogue renderings and "never up to date" (Task 7, D-3306), with `never checked` meaning lastOkAt AND lastError both null — which a restart re-creates, because W2 keeps `catalogueState` in the poller's memory (W2 Task 10, D-3182: the first tick after a restart polls at once) — hence "until the server's first poll since it started"; `sortReleases`, `verifiedAt`, `bundle listed`, the `<pre>` notes (Task 8); `canAck` and W2's `ackNode` (idle + request cleared + refusals deleted, W2 Task 5); `MOVE_DISABLED_TEXT` on all five move controls (Tasks 8, 9, 11); `unarmedExposure` (Task 10, D-3298); `UpdateBanner`'s `lastOkAt` gate and `pendingTag` — `measuredAt`, channel and (Task 9, D-3307) `stampRead` (Tasks 5, 9, 11); the `BuildLine` affix (Task 12), which reads `pendingTag` ALONE and has no `lastOkAt` gate — spec §13's "unreachable is not current" gates only "up to date" on `lastOkAt`, and a restarted server resolves desired tags from the catalogue rows `coord.db` kept, so the text must not claim the arrow waits for GitHub (correction: an earlier draft said "neither speaks before GitHub has been reached"); `pushRelease` on `server`/`both`, `markReleaseNotified` before the unawaited send, the mark-only arm, no presence gate, `RELEASE_PUSH_URL` (Tasks 1–4, D-3295, D-3294, D-3296); "at most one … for the newest tag" and "every MEASURED node" are Task 2's `releaseToNotify` — its candidate is `eligibleTags(…)[0]` ONLY (an older unnotified tag is never announced), it answers null while no node has `measuredAt !== null`, and `push` reads measured nodes only (correction: an earlier draft said "ONE Web Push per release tag" and "a tag every node already runs", both wider than the decision). Reword one and the claim must still match its task. Count the inserted block after pasting: 18 lines plus one blank — Step 3's figure depends on it.

- [ ] **Step 3: Re-measure the README size claim, in this commit**

```bash
wc -l < README.md
grep -o 'README.md` (~[0-9,]* lines)' CLAUDE.md
echo $(( ($(wc -l < README.md) + 50) / 100 * 100 ))
```
`pools-prose.test.ts:868-880` reds when CLAUDE.md's `~N lines` is more than 100 from README's real line count, and `oss-metadata.test.ts:89-100` at 10%. README was 3279 at `d759c914`; W2 Task 15 added 22 lines and set the claim to `~3300` (its Step 3); this task's (a) is line-neutral and (b) adds 19 — expected `3320`, and the rounded figure `3300`, equal to the claim: CLAUDE.md is NOT edited. If the rounded figure differs from the claim (README moved elsewhere on `main` since W2), set `CLAUDE.md:10`'s figure to it — the figure's existing precision — and name that in the wave-done; CLAUDE.md's own line count does not change either way.

- [ ] **Step 4: The doc guards, then commit**

Run, from `server/`, foreground, one file at a time, timeout ≥ 600000 ms:

```bash
cd server
for t in pools-prose oss-metadata session-hook box-token-census coord-pause-route crossrepo-prose readme-holds readme-roster-mirror ccrc-update license ccrc-install-graphify worker-skill reviewer-skill coordinator-skill ledger-instruction topology-clean; do
  ./node_modules/.bin/vitest run "test/$t.test.ts" || { echo "RED: $t"; break; }
done
```
Expected: all green. `session-hook` is a known load flake (CLAUDE.md) — a red there is re-run in isolation before it is read as the paragraph's fault; a real red from it names a README citation, and the remedy is to drop the `:<digits>` token from the new text, never to add a README anchor. `ccrc-update` is long (it drives `ccd/ccrc` in fixture HOMEs); a red in it that is not "no longer states the bash ≥ … floor" is not this edit's. `topology-clean`'s history-range scan needs `origin/main` resolvable — Step 1 fetched it.

```bash
git add README.md
git commit -m "docs(update): the settings screen, the update banner and release pushes in the Releases section; W2's 'not yet' loses the two items W3 ships"
```
(Add `CLAUDE.md` to the `git add` only if Step 3 changed it.)

- [ ] **Step 5: The plan carries minted numbers, not placeholders**

```bash
git fetch origin main
git grep -nE '«dev:[a-z0-9-]+»' -- docs/superpowers/plans/2026-09-23-centralised-update-w3-settings-and-notification.md
git grep -nE '«dev:[a-z0-9-]+»' -- server/src server/test pwa/src pwa/test pwa/public pwa/design shared README.md CLAUDE.md
git grep -nE 'D-TBD-[a-z0-9]' -- docs/ server/ shared/ agent/ ccd/ pwa/ README.md CLAUDE.md
```
Expected: all three print nothing. The first two patterns need a real slug between the guillemets, so they do not match this step's own text or an ellipsis form; the second covers the code comments the tasks carried placeholders into (Tasks 1–12 wrote «dev:…» in comments, ruling R12: the coordinator's one pass replaces them there too); the third is `dtbd.test.ts`'s `PATTERN`. If a placeholder remains, the coordinator has not minted that departure: STOP and put it to the coordinator as a structured ask (worker skill) naming the slug and its file — never allocate or type a `D-` number here (`POST /api/ledger/deviations` issues numbers; a number written without being issued seals its band for good).

Then, from inside `server/`:

```bash
./node_modules/.bin/vitest run test/deviation-refs.test.ts
./node_modules/.bin/vitest run test/dtbd.test.ts
./node_modules/.bin/vitest run test/topology-clean.test.ts
```
Expected: PASS. `deviation-refs` compares this branch's plan entries against `origin/main`'s without merging — a red names a number defined in two plans, which is the coordinator's to re-mint, not this task's to edit.

- [ ] **Step 6: Every suite, unsharded, as CI runs it — and the wave's own source scans**

CI's server leg installs `agent/` and `pwa/` modules too, because `typecheck-tests.test.ts` spawns their compilers. So first:

```bash
test -d agent/node_modules || (cd agent && npm ci)
test -d pwa/node_modules || (cd pwa && npm ci)
```

Then, each in the FOREGROUND with the tool's maximum timeout (600000 ms), one command per call:

```bash
cd pwa && ./node_modules/.bin/vitest run
cd pwa && npm run build
cd server && ./node_modules/.bin/vitest run
cd server && ./node_modules/.bin/tsc --noEmit
cd agent && ./node_modules/.bin/vitest run
cd agent && ./node_modules/.bin/tsc --noEmit
```
Expected: all green, `npm run build` exit 0 (`tsc --noEmit` over `src` and `test`, then the vite build), and both `tsc --noEmit` exit 0 — CI's `Typecheck` step (`.github/workflows/ci.yml:127-129`) runs it in every package, and `server/tsconfig.json` includes `src` and `../shared` only, so it is the check that sees a type error in Tasks 1–3's `server/src` edits and in the L0 files (`shared/update-summary.ts`, `shared/api.ts`) under the server's settings; `typecheck-tests.test.ts` covers the test trees. Put each summary line's file and case counts in the wave-done: a green that ran fewer cases than `main` is not the same green — compare the pwa and server counts against the latest `ci` run on `main` (`gh run list -b main -w ci --limit 1`, then `gh run view <id> --log | grep -E 'Test Files|Tests '`); the difference must be exactly this wave's new cases. If the unsharded server run is killed or exceeds the tool ceiling on this box, run the SAME file set in four foreground batches and say so in the wave-done — CI's unsharded leg is then the arbiter:

```bash
cd server && ls test/*.test.ts | split -n r/4 - "$SCRATCH/w3-shard."
./node_modules/.bin/vitest run $(cat "$SCRATCH/w3-shard.aa")   # then .ab, .ac, .ad — one call each
```
(`$SCRATCH` is the session scratchpad directory.) A red in a known load flake (`ccd-ws-gc`, `pr-sweep`, `session-hook`, `typecheck-tests`, `ccd-session-state`, `ccd-bounded-reads`) is re-run in isolation before it is called a break; a red anywhere else is this wave's until shown otherwise.

The contrast gate and its blind spot, from `pwa/`:

```bash
node design/contrast-check.mjs; echo "exit $?"
node design/contrast-check.mjs --uncovered | grep -E '^#   .*(settings-|update-banner|build-line-next)'
```
Expected: `exit 0` with no FAIL row, and the grep prints nothing (it reads only the census rows, which `--uncovered` prints as `#   <sheet> <selector>` after the report — every measured rule also prints as a `PASS … fleet.css .settings-…` row, so an unanchored pattern would print the wave's own passing rules and could never be empty; correction, measured at `d759c914`: the anchored grep prints nothing there and `--uncovered` lists 255 `#   ` rows) — every colour rule this wave appended (`.settings-*`, `.update-banner*`, `.build-line-next`) is either self-grounded or registered in `INHERITED_GROUNDS`; `contrast.test.ts`'s "contains no identities beyond the grandfathered blind spots" (run in the pwa suite above) is the mechanism, this grep is its reading.

The wave's literal claims, read off the tree (each is pinned by a task's test; this is the reviewer-facing reading, not a second mechanism):

```bash
git grep -nE '/api/updates/(apply|rollback)' -- pwa/src
git grep -n 'dangerouslySetInnerHTML' -- pwa/src/screens/SettingsScreen.tsx pwa/src/fleet/UpdateBanner.tsx
git grep -nE '\.builds\b' -- pwa/src
```
Expected: the first prints exactly one line, in `pwa/src/screens/SettingsScreen.tsx` — `UNARMED_EXPOSURE_TEXT`'s sentence naming `POST /api/updates/apply` (Task 10) — and nothing in `pwa/src/lib/api.ts` (Task 5's census pins that file); the other two print nothing (Tasks 8/11, Task 12).

Then the gate files, from `server/`:

```bash
./node_modules/.bin/vitest run test/deviation-refs.test.ts test/dtbd.test.ts test/topology-clean.test.ts test/session-hook.test.ts test/single-definition.test.ts
```
Expected: PASS.

- [ ] **Step 7: Push and open the PR**

Check the commit identity before the push (the pre-push hook refuses identity residue, and a workspace can carry a placeholder identity):

```bash
git log --format='%an <%ae>' origin/main..HEAD | sort -u
git config user.name; git config user.email
```
Expected: one author line, equal to the configured identity, and that identity the operator's intended one. If it is not, STOP and ask — rewriting authorship is not this task's call.

```bash
git push
REPO_URL="$(gh repo view --json url --jq .url)"
PLAN=docs/superpowers/plans/2026-09-23-centralised-update-w3-settings-and-notification.md
SPEC=docs/superpowers/specs/2026-09-20-centralised-update-management-design.md
{
  echo "W3 of the centralised update management design: the settings screen, the update banner, and one Web Push per release. No control in this PR moves a node."
  echo
  echo "- Spec: $REPO_URL/blob/main/$SPEC (section 13 in full, section 12's unarmed-exposure banner, section 14's first bullet; the W3 row of section 15)"
  echo "- Plan: $REPO_URL/blob/main/$PLAN"
  echo
  echo "Tasks:"
  grep -E '^### Task [0-9]+:' "$PLAN" | sed 's/^### /- /'
  echo
  echo "Deviations defined in the plan:"
  grep -oE '^- \*\*D-[0-9]+\*\*[^.]*' "$PLAN" | sed 's/^- //'
  echo
  echo "Out of scope (later waves): the apply and rollback routes and every control that calls them (rendered disabled here), the dispatcher and the agent update op (all the spec's W4, which the programme ships as its waves 4 and 5), the PWA bundle's own update, a theme control. FleetHealth.builds stays on the wire, unread by the PWA (spec section 14 retires it later)."
  echo
  echo "CLAUDE.md: unchanged — this wave adds no route, credential, gate or doctrine, and the README size claim still holds (measured in the docs commit)."
  echo
  echo "Test plan: pwa, server and agent suites green locally — counts below; CI is the arbiter."
  echo "<pwa: Test Files / Tests lines>"
  echo "<server: Test Files / Tests lines>"
  echo "<agent: Test Files / Tests lines>"
  echo
  echo "Exit criterion (the coordinator's, after rollout): the operator sees the update banner on the phone within one poll of a merge whose release the catalogue lists, and switches channel from the settings screen."
} > "$SCRATCH/w3-pr-body.md"
```
Replace the three `<… lines>` placeholders in `$SCRATCH/w3-pr-body.md` with Step 6's measured summary lines (never retyped — paste them from the run's output); if Step 3 changed CLAUDE.md, replace the CLAUDE.md line with what changed. Append the session's attribution line (from the system reminder) as the body's last line, then:

```bash
grep -c '^- \*\*D-[0-9]' "$PLAN"
gh pr create --base main \
  --title "feat(update): W3 — /settings, the update banner, release push" \
  --body-file "$SCRATCH/w3-pr-body.md"
```
Expected: the `grep -c` is the number of entries in the plan's `## Deviations found` (every departure the plan defines, plus any a task found during execution and defined in the same commit) — a `0` means the numbering pass has not happened and Step 5 should already have stopped you. The PR body carries `blob/main` links only — never a docserver link (it is tailnet-only and dies with the worktree).

- [ ] **Step 8: CI**

```bash
PR="$(gh pr view --json number --jq .number)"
gh pr checks "$PR" --watch --fail-fast
```
Run it in the foreground and re-issue it until it returns: exit `0` is all green, `1` a failure (read the failing leg's log first — `gh run view --log-failed`), `8` still pending (an answer, not an error). Never end the turn to wait for CI; a session that does is not woken by the result. The macOS leg runs the server suite again and can take up to half an hour — re-issue the watch; do not merge around it.

- [ ] **Step 9: The wave-done**

When green, report the wave-done per the `ccrc-worker` skill: the measured fingerprint (`git rev-parse HEAD` equal to `git ls-remote origin "refs/heads/$(git branch --show-current)"`), the PR number, the suite counts from Step 6, and the FIXTURE proofs that stand in for the live exit criterion, by test file:
- `server/test/push-copy.test.ts` (Task 3's appended describe) — the copy (`ccrc v0.0.9 is out`, `On stable — fleet and server are on v0.0.7. Tap to see what's new.`, `release-v0.0.9`, `/settings`); a second `pushRelease` sends nothing; a NEW watcher over the same `coord.db` sends nothing; `notify: 'stable'` skips a dev tag; a current fleet is marked, not pushed; the mark is committed before `notify` is called; wired through both lanes (the live "one push per tag, across restarts" and "the push lands on settings");
- `pwa/test/push-sw.test.ts` (Task 4) — a tap with `data.url: '/settings'` opens `['/settings']`; a cross-origin, protocol-relative or backslash url falls back (the SW half of "the push lands on settings");
- `pwa/test/settings-screen.test.tsx` (Tasks 6–10) — the channel radio checked from the `'*'` row and a tap sending `{scope: '*', channel: 'dev'}` then re-polling; every move control disabled beside `lands with the next release (W4)`; `lastOkAt: null` never renders `checked` (the live "switches channel from the screen");
- `pwa/test/update-banner.test.tsx` and `pwa/test/fleet-screen.test.tsx` (Tasks 11, 12) — the banner on a newer release, silent on equal / `lastOkAt: null` / unmeasured; the screen polls `/api/updates` ONCE and hands it to the banner, `BuildLine` and the skew arm (the live "sees the banner within one poll").

The worker does not merge: `main`'s ruleset wants an approval nobody can give, so the operator merges with `--admin`.

- [ ] **Step 10: The live exit criterion (the coordinator, after rollout)**

The merge cuts a PRERELEASE (the `dev` channel). Take the tag the release lane put on the MERGE commit — not "the newest release", which is another PR's if anything merged after:

```bash
PR=<the W3 PR number>
git fetch origin main --tags
MERGE="$(gh pr view "$PR" --json mergeCommit --jq .mergeCommit.oid)"
W3_TAG="$(git tag --points-at "$MERGE" | grep -Ex 'v[0-9]+\.[0-9]+\.[0-9]+')"; echo "$W3_TAG"
gh release view "$W3_TAG" --json isPrerelease --jq .isPrerelease     # true: the dev channel
ccrc rollout --check
ccrc rollout --to "$W3_TAG"
```
Expected: exactly one tag; both boxes on `W3_TAG`, exit `0` (or `3` with the doctor's FAIL lines read — the box is on the build). W3 changes no agent frame and no `ccd`, so the default fleet-first order is only the habit, not a requirement.

On the phone (the operator; the coordinator records what the operator reports):

1. Open the fleet screen; tap **Settings**. Expected: the `/settings` screen with the catalogue line reading `checked … ago` (the first tick after the restart polls GitHub at once), both nodes in the inventory on `W3_TAG` with provenance `verified`, and every Install / Roll back / Update control disabled beside `lands with the next release (W4)`; no red unarmed banner (the live box runs with `CCRC_AUTH` armed).
2. Note the channel the fleet row holds (`C0`); choose the OTHER channel's radio (`C1`). Expected: the radio stays on `C1` after the screen's re-poll.

On the server box, in the operator's own shell — the `ccrc_session` cookie value comes from a signed-in browser and is typed, never echoed, logged or pasted into a transcript:

```bash
ssh -t <server box>
read -rs CCRC_SESSION
curl -fsS -b "ccrc_session=$CCRC_SESSION" http://127.0.0.1:7788/api/updates \
  | jq '{lastOkAt: .catalogue.lastOkAt, fleet: [.intent[] | select(.scope == "*") | {channel, notify, auto}],
         nodes: [.nodes[] | {label, version: .current.version, channel, desiredTag, update: .update.state}]}'
awk '$1=="channel"' ~/.ccrc/update-intent
```
Expected: `lastOkAt` non-null; the `'*'` row's `channel` = `C1` and `auto` = `off`; the projection's `channel C1`; both nodes `update: "idle"` (nothing moved — W3 ships no dispatcher). That is the "switches channel from the screen" half.

3. The banner half. With `C1 = dev` (choose `dev` in step 2 if the fleet was on `stable`; a prerelease is desired only on `dev`), wait for the NEXT merge to `main` — any PR — to publish its prerelease (`gh release list --limit 1` names a tag newer than `W3_TAG`). On `/settings`, tap **Check now**. Expected: within one poll (≤ 60 s) the fleet screen shows `<new tag> is out on dev — fleet and server are on <W3_TAG>.` with **Update all** disabled, and `BuildLine` reads `fleet <W3_TAG> → <new tag> · server <W3_TAG> → <new tag>`; ONE Web Push `ccrc <new tag> is out` arrives (if this browser subscribed through the bell) and tapping it opens `/settings`. A second push for the same tag never arrives — tap **Check now** again after a minute to force a second poll and a second decision; nothing is sent.
4. Restore the channel the operator wants (the radio back to `C0`, unless they keep `dev`), then `unset CCRC_SESSION` in the server-box shell.

That set is spec §15's W3 exit criterion measured on the live fleet; record the outcome in the programme's memory file (`centralised-update-management-programme`: W3 SHIPPED, the tag, the deviations) — wave 4 (the node side) is next.

