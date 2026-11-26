# Landing order, wave 5k — the console of the operator's two doors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan dispatches nothing itself: the wave is built by a worker the coordinator dispatches.

**Status:** drafted on 2026-11-26 for run 3891 (programme `landing-order`, the run's wave 29) from the brief's nine decisions; **revised the same day in fix round 1, after review run 3895, with the coordinator's rulings (call 1388; section 10 lists each and where it went).** One build wave; section 2 says why it is not split and where the seam would be.

**Goal:** The operator sees one project's landing line on its card on the fleet screen, and can pause and resume that line with one tap and withdraw one entry through a sheet, all through the server's existing read and two doors.

**Architecture:** Pure words and a pure view model (L1) turn `GET /api/landing`'s answer and the doors' answers into sentences and rows. Three thin calls in `lib/api.ts` (L3) reach the read and the two doors. One hook on the PWA's one poll primitive (`usePoll`, L4) reads the line of every card's project every 60 seconds, on each return to the page and after each door's answer. Two components (L4) draw the line and the sheet; they decide nothing. The project card gains one mount point. A first, server-side task does the four carries from wave 5j, and a second declares the two door answers once, in L0, so the console names a shared type rather than a copy.

**Tech Stack:** TypeScript ESM, React, `@ccrc/ui` (Sheet, Button, Chip), Vitest with jsdom and Testing Library, the Playwright browser suite (`pwa/browser`), Node >=22.16.0. No dependency, migration, route, `ccd` verb, client verb or wire version change.

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` §5.5 ("PWA doors", with its amendment of 2026-11-25) and §6's `pwa/src` row ("predicted-conflict chip; the line on the project card; pause and withdraw"). Server half: `docs/superpowers/plans/2026-11-25-landing-order-wave5j-doors.md` sections 4.3 to 4.5, section 9 and section 13 (its last list is Task 1 here). Ledger: `docs/superpowers/programs/landing-order.md`, row 5k, and Decisions 2026-11-26 02:10.

**Source baseline:** `origin/main` at `d95e6256bde6c8a5bfa4c7922f13dbaa1d8d819f`. Every present-tense claim about the code below was read there by this plan's author and three read-only scouts. A builder whose dispatch base is newer re-reads each cited owner before changing it and says what moved in the task note.

**What was measured:**
- **No file under `pwa/src` reads the line.** `LandingLineView`, `operatorPaused` and `mainRedHold` appear only in `shared/` and `server/`. The one landing fact on the fleet frame is the radar's per-session `FleetSession.landing` (`shared/api.ts#SessionLanding`), which says nothing about entries, order or pauses.
- **There is no list of projects with a line.** `GET /api/landing` requires `?project=` and reads one project (`server/src/coord/routes.ts`, the `GET /api/landing` handler; `CoordStore.readLanding`).
- **One read is cheap.** Measured through `ccrc-api landing show` on 2026-11-26: a project with one open entry answered 581 bytes; a project the line has never seen answered 200 with about 250 bytes (`entries: []`, both flags `false`, `order: {paused: false, order: [], head: null}`). The client's whole call, node start-up included, took 0.16 s to 0.27 s. The server does one synchronous read of the landing tables for that project and computes the order; it runs no `git` or `gh`.
- **The read's failures** are `unauthenticated` (401, armed only), `not-configured` (501), `bad-request` (400) and every `LandingInfrastructureCode` (503), `landing-projection-unreadable` included, carrying `recovery`.
- **The doors' answers are server-only types today.** `LandingPauseWrite` and `LandingWithdrawWrite` live in `server/src/coord/landingWrites.ts` (L1), which the PWA cannot import. The routes send `{ ok: true, ...answer }`, dropping `coordinator` from a withdrawal.
- **The withdraw door can answer** `bad-request`, `landing-entry-missing`, `landing-entry-terminal`, `landing-entry-moved`, `landing-recovery-unresolved`, `landing-identity-conflict`, `landing-sequence-overflow`, `landing-record-unparseable`, `run-unreadable`, every `LandingInfrastructureCode`, `not-configured`, and, armed, the gate's `unauthenticated`. The pause door answers the same less the four entry words and `run-unreadable`, plus `landing-project-unknown`.
- **The fleet screen has one card renderer for every width and both skins.** `pwa/src/fleet/FleetCards.tsx#FleetCards` maps each group to `pwa/src/fleet/ProjectCard.tsx#ProjectCard` (`memo(ProjectCardView, sameCardProps)`; every prop compared by identity except `placement`). Instrument's `FleetTable` places the same `FleetCards` in its project mode; its status mode draws no project cards.
- **The project is `group.project`**, a string. **Every known project has a card,** whether or not anything is on it (`pwa/src/fleet/groupFleet.ts`, rule R5): `FleetCards` passes `projects.knownProjects`, every row of `GET /api/projects`. The review approximated that at 31 on the fleet box (the directories under its projects root).
- **The PWA has one poll primitive,** `pwa/src/lib/usePoll.ts#usePoll` (`pollMs: null` asks on mount and on every return to the page, with no timer). `server/test/rings/pwa-one-owner.test.ts` caps hand-written request polls at two named files, and `server/test/census-w7/pwa.ts#requestPollsIn` finds them.
- **Reads on a timer through `usePoll` are already the fleet screen's pattern:** the fleet health read at 15 s, the claims strip at 30 s, and the settings views of its sheets at 60 s. `usePoll`'s timer is a plain `setInterval`; it re-polls on return to the page where `refetchOnVisible` is true (the default).
- **One identifier is taken.** `server/test/rings/pwa-one-owner.test.ts` counts every identifier and every string spelled exactly `landing` in `pwa/src` outside `fleet/conflictWords.ts`, the one reader of `FleetSession.landing`, and expects one site. So no new prop, local or string in this wave is spelled `landing`.
- **`FleetCards`' view-hold key** (`holdKey`, feeding `useHoldView`, D-6090) counts each card's rows or kept boxes. `pwa/test/programme-box-card.test.tsx` pins its exact text (`project-c:-0`).
- **`pwa/src/lib/api.ts` and `pwa/src/fleet/fleet.css` are growth-checked** (`server/test/growthCheck.ts#GROWTH_FILES`, 40 net code lines per PR), and `fleet.css` carries an absolute cap that may only fall. New styles go in a new file.
- **`@ccrc/ui`'s `Sheet`** is controlled (`open`, `onClose`), traps focus, takes `title` and `footer`, and renders as a centred dialog from 900px. `Button` has `primary`, `danger`, `danger-ghost`, `ghost` and `quiet` variants. `Chip` has no tone prop, by design (`pwa/src/session/chipTones.ts`). Nothing is missing for this wave.
- **The house sheet for an operator door** is `pwa/src/fleet/LiftCapSheet.tsx`: a generation ref drops a superseded answer, a refusal stays inside the open sheet, and the call is an injectable prop.
- **Refusal words are `Record<Union, string>` tables read through `refusalText`** (`pwa/src/lib/refusalWords.ts`). `pwa/test/refusal-literal-ratchet.test.ts` refuses a new branch that compares a code to a string literal.
- **PWA files take a context from the table** in `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` between its `ring-context-map` markers (`server/test/rings/totality.test.ts`). C1's `pwa/src` cell opens with `fleet/**`, so a new `fleet/` file with no file row is quietly C1 and `rings/totality` stays green either way. Landing's console files belong in C5 Coordination beside `fleet/ConflictChip.tsx`, so each gets a C5 file row; nothing goes red if one is left out, so the reviewer checks the rows by reading section 9.
- **The PWA has no Storybook of its own.** Stories live in `ui/src`, and the advisory `storybook-a11y` job runs axe over them. This wave adds no primitive, so it adds no story; its accessibility checks are component cases and browser cases (section 7).

## 1. Decisions

The brief's nine decisions, and how this plan keeps each.

| # | Decision | How this plan keeps it |
|---|---|---|
| 1 | The line shows on the project card, only when there is something to say; the smallest honest read on the existing polling owner, no new poller, no second cache | One `useLandingLines` hook in `FleetCards`, on `usePoll` at 60 seconds (Q1 ruled yes; an interval on `usePoll` is what the fleet screen's other reads do), reads `GET /api/landing` for every known project's card, again on each return to the page and after each door's answer (D-9108). No cache: the last good answer lives in the hook's state. "Something to say" is an open entry, or the operator's own pause (Q2 ruled; section 4.2). |
| 2 | What the line says, in words; no order or head of the console's own | The view model draws the read's `order.order`, then the other open entries in the read's order. "Next to land" marks `order.head` only, in the spec's own words for it. `waits` names each target's PR. Ejected, unknown, paused by whom, held and main-red-with-a-fixing-head each have their own words (section 4.2). |
| 3 | Pause and resume: one control, one tap, no confirmation; the result from the read | `LandingLine`'s button sends the opposite of the read's `operatorPaused`, then re-reads; its label comes only from the read (row M8). |
| 4 | Withdraw is a sheet | `LandingLine` keeps rendering while its sheet is open, so the sheet outlives a line that the re-read reduces to nothing (F1). `LandingWithdrawSheet` names the entry, says what a withdrawal does and does not do in section 9 block 3's terms, lists the direct dependants as read, has one confirm button, sends the read's `pinnedAt`, and after the answer names who was told and who could not be, and that an entry with no run cannot come back. |
| 5 | Every refusal has its own sentence | `landingWords.ts` (L1): one exhaustive record over `LandingInfrastructureCode | LandingMutationCode` and the four route words. `landing-entry-moved` re-reads the line and says the entry changed. An unknown word and an unreachable server each get an honest generic sentence. |
| 6 | Sign-in dark changes nothing on screen | No component reads a sign-in fact; no words for it. A lapsed session's 401 is `lib/api.ts`'s, which already raises the sign-in screen. |
| 7 | Rings and the design system | Words and view model L1, calls L3, hook and components L4; `@ccrc/ui`'s `Sheet`, `Button` and `Chip` as they are; tokens only; phone width first. |
| 8 | New files where possible | Six new files under `pwa/src/fleet/`. Existing files touched: section 3's list. |
| 9 | The carries | Task 1, server-side, its own commit. |

**Choices this plan made inside them:**
- **The two door answers are declared once, in L0** (Task 2, D-9107). The brief says to name the shared types and define no copy; the answers had no shared type, so the server's write types are re-expressed over two new L0 interfaces and the console names those.
- **A read failure is drawn by its scope** (D-9109). A failure of the whole box (the journal, the database, the fence, a bad answer, an unreachable server) shows only over a line the card already drew, as "not read again", and never adds a block to a card with nothing to say. A project's own damaged row (`landing-projection-unreadable`) always shows on that card, because only a project with a line can answer it. `not-configured` draws nothing anywhere.
- **An `unknown` row has no `Withdraw…` button** (Q-B ruled). The server refuses every withdrawal of such a row, because its stored pin time does not read (the 5j plan's section 13, C14), so the button could only produce a false "it was pinned again". The view model marks the row not withdrawable from the read's state word, and the row says so. This presents a read field; it decides nothing about the line.
- **Every door answer, refusal or not, re-reads the line.** A refusal therefore needs no per-word branch (the ratchet allows none), and `landing-entry-moved`'s sheet shows the entry as it now stands.
- **A known refusal word is a known outcome, except the three the server marks as possibly applied** (`mayApply`): `landing-journal-append`, `landing-db-apply` and `landing-db-commit`, measured in `CoordStore.writeLandingAuthority`'s failure arm. Those three, and a request that got no readable word back (a transport failure, an unreadable body, an unknown word at a status of 500 or more), are described as "whether it took effect is not known".

## 2. One wave, and the seam if it is split

The wave is one build of eight tasks: two small server tasks, two pure files, three calls, one hook, two components and their mount, and one browser file. It fits one context with subagent-driven development, as 5j-a's five tasks did.

The coordinator ruled one wave (call 1388). The seam below remains for the builder if its context runs short; it then stops after Task 5, reports, and the rest is dispatched as 5k-b.
- **5k-a (Tasks 1 to 5):** the carries, the L0 answers, the words, the view model, and the three calls. Nothing is mounted, so nothing on screen changes; every new export has its pure tests, and the rings and totality censuses pass with the new files' rows.
- **5k-b (Tasks 6 to 8):** the hook, the two components, the mount and the browser file. It needs 5k-a's exports and nothing on a live box, so it lands green alone after 5k-a merges.

## 3. File responsibilities

| File | Ring, context | Task | Responsibility |
|---|---|---|---|
| `server/test/landing-subtractive.test.ts` | test | 1 | The table list is checked against the schema's `landing_*` tables. |
| `server/src/coord/landingWrites.ts` | L1, C4 | 1, 2 | Header comment reworded (1); the two write types re-expressed over the L0 answers (2). |
| `server/test/landing-doors-route.test.ts`, `server/test/landing-writes-act.test.ts`, `server/test/landing-writes.test.ts` | test | 1 | One comment; the withdraw event's run arm; the time formatter's boundary cases. |
| `shared/landingLine.ts` | L0 | 2 | `LandingPauseAnswer`, `LandingWithdrawAnswer`. Imports nothing. |
| `pwa/src/fleet/landingWords.ts` (new) | L1, C5 | 3 | Every sentence: refusals, failures, notices, row and status words, the control's and the sheet's text. |
| `pwa/src/fleet/landingLineView.ts` (new) | L1, C5 | 4 | The wire guard, the card's view model, the withdraw preview, the per-card state reducer. |
| `pwa/src/lib/api.ts` | L3 | 5 | Three calls. |
| `pwa/src/fleet/useLandingLines.ts` (new) | L4, C5 | 6 | The one read of every card project, on `usePoll` at 60 seconds. |
| `pwa/src/fleet/LandingLine.tsx` (new) | L4, C5 | 7 | The line block and the pause control. |
| `pwa/src/fleet/landing-line.css` (new) | L4, C5 | 7 | The block's, the rows' and the sheet's styles, tokens only. |
| `pwa/src/fleet/LandingWithdrawSheet.tsx` (new) | L4, C5 | 7 | The withdraw sheet. |
| `pwa/src/fleet/FleetCards.tsx`, `pwa/src/fleet/ProjectCard.tsx` | L4 | 7 | The hook's call, two props and the hold key's landing part; one mount line, one ref and `tabIndex={-1}` on the card's section. The prop and the local are `landingLine` and `onLandingLineReload`, never `landing`: `rings/pwa-one-owner` counts every identifier and string spelled `landing` in `pwa/src` as a reader of `FleetSession.landing`. |
| `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` | — | 4, 6, 7 | Six file rows in C5's `pwa/src` cell, each added in the task that creates its file. |
| `README.md` | — | 7 | Section 6's one block. |
| `pwa/browser/landing-line.browser.test.ts` (new) | test | 8 | The browser cases. |

**Existing files the builder must claim before starting** (they are shared with other programmes): `pwa/src/fleet/FleetCards.tsx`, `pwa/src/fleet/ProjectCard.tsx`, `pwa/src/lib/api.ts`, `pwa/test/project-card.test.tsx`, `pwa/test/programme-box-card.test.tsx` (if its hold keys need the landing part; they should not, section 4.5), `shared/landingLine.ts`, `server/src/coord/landingWrites.ts`, `server/test/landing-subtractive.test.ts`, `server/test/landing-doors-route.test.ts`, `server/test/landing-writes-act.test.ts`, `server/test/landing-writes.test.ts`, `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` and `README.md`.

Do not add a route, a second `usePoll`, a `setInterval`, a store, a cache key, a `localStorage` use, a new `@ccrc/ui` primitive or a colour token. Do not edit `fleet.css` or `pwa/browser/app.ts`'s shared fixture. Do not compare a refusal code to a string literal anywhere (`refusal-literal-ratchet`). Do not spell an identifier or a string `landing` in `pwa/src` (`rings/pwa-one-owner`).

## 4. Interfaces

### 4.1 The door answers (L0, `shared/landingLine.ts`; Task 2)

Beside `LandingNoticeOutcome`:

```ts
/** `POST /api/landing/pause`'s 200 answer beside `ok` (wave 5j-b; declared here in wave 5k, D-9107). `changed: false` with
 *  `seq: null` for a pause or resume that matched the flag. */
export interface LandingPauseAnswer { project: string; operatorPaused: boolean; changed: boolean; seq: number | null }
/** `POST /api/landing/withdraw`'s 200 answer beside `ok` (wave 5j-b; declared here in wave 5k, D-9107): the entry after and
 *  before, the record's seq and what each notice did. */
export interface LandingWithdrawAnswer { entry: LandingEntry; previous: LandingEntry; changed: true; seq: number; notices: LandingNoticeOutcome[] }
```

`server/src/coord/landingWrites.ts`: the ok arms become `({ ok: true } & LandingPauseAnswer)` and `({ ok: true; coordinator: Coordinator } & LandingWithdrawAnswer)`. The failure arms are unchanged. The routes are unchanged.

The console reads three shared types and defines none of its own: `LandingLineView` (with `LandingEntry`, `LandingOrder`, `LandingWait`, `LandingPauseBy`, `LandingEjectionKind`), `LandingPauseAnswer` and `LandingWithdrawAnswer` (with `LandingNoticeOutcome`), and the code unions `LandingInfrastructureCode` and `LandingMutationCode`.

### 4.2 Words and the view model (L1; Tasks 3 and 4)

**`pwa/src/fleet/landingWords.ts`** imports types from `shared/landingLine.ts`, `ApiError` and `writeOutcomeUnknown` from `lib/apiError.ts`, and `refusalText` from `lib/refusalWords.ts`. Nothing else at runtime.

```ts
/** Every word a landing route can answer the console: the line's two code unions and four route words. */
export type LandingRouteWord = LandingInfrastructureCode | LandingMutationCode | 'run-unreadable' | 'bad-request' | 'not-configured' | 'unauthenticated';
/** Where a read failure is drawn (D-9109): `project` on its own card always, `box` only over a line already drawn, `absent` nowhere. */
export type LandingFailureScope = 'project' | 'box' | 'absent';
/** `mayApply`: the server marks this word as possibly applied (a write that entered the append). */
export const LANDING_ROUTE_WORDS: Readonly<Record<LandingRouteWord, { text: string; scope: LandingFailureScope; mayApply: boolean }>>;
/** Derived from `LANDING_ROUTE_WORDS` (`Object.fromEntries` over its entries), so `refusalText` can read it; never hand-kept. */
export const LANDING_ROUTE_TEXT: Readonly<Record<LandingRouteWord, string>>;
export type LandingDoor = 'read' | 'pause' | 'withdraw';
export interface LandingFailure { text: string; scope: LandingFailureScope; outcomeUnknown: boolean }
/** Never throws, never answers an empty sentence. */
export function landingFailureOf(err: unknown, door: LandingDoor): LandingFailure;
/** One sentence per notice outcome; `prOf` names a dependant's PR from the line as read, `null` when it is not there. */
export function landingNoticeText(o: LandingNoticeOutcome, withdrawnPr: number, prOf: (entryId: number) => number | null): string;
```

`landingFailureOf`'s rules, first match wins:
1. An `ApiError` whose body's `error` is a word of the table: the text is `refusalText(err, LANDING_ROUTE_TEXT)`; the scope and `mayApply` come from the same word, read off the body and checked with `Object.hasOwn(LANDING_ROUTE_WORDS, word)` (no literal comparison); `outcomeUnknown` = `door !== 'read' && mayApply`.
2. An `ApiError` whose body's `error` is another string: `UNKNOWN_WORD_TEXT(word)`, scope `box`, `outcomeUnknown` = `door !== 'read' && status >= 500`.
3. An `ApiError` with no readable word: `UNWORDED_TEXT(status)`, scope `box`, `outcomeUnknown` = `door !== 'read' && writeOutcomeUnknown(err)`.
4. Anything else (a timeout, a dropped connection): the read's or the write's unreachable sentence, scope `box`, `outcomeUnknown` = `door !== 'read'`.

A rule-2, rule-3 or rule-4 write sentence ends with `OUTCOME_UNKNOWN_TAIL` exactly when `outcomeUnknown` is true.

**The full words table.** Every sentence the wave ships is here; a builder may not add, drop or reword one without a deviation. `mayApply` is `true` for exactly `landing-journal-append`, `landing-db-apply` and `landing-db-commit`, and `false` for every other word. A door answers `landing-journal-durability` nowhere (only replay does), so it carries no outcome claim.

| Word | Scope | Sentence |
|---|---|---|
| `landing-journal-unavailable` | box | The landing line's journal could not be opened, so nothing was read or changed. Try again in a minute; if it stays, the server needs a restart. |
| `landing-journal-unreadable` | box | The landing line's journal could not be read, so nothing was read or changed. If it stays, the server needs a restart. |
| `landing-journal-invalid` | box | The landing line's journal holds a record this server cannot read, so nothing was read or changed. The line stays stopped until the journal is repaired. |
| `landing-journal-missing` | box | The landing line's journal is missing on the server, so nothing was read or changed. The line stays stopped until the journal is back. |
| `landing-journal-cursor` | box | The landing database and its journal disagree about how far the journal was applied, so nothing was read or changed. A restart replays the journal. |
| `landing-journal-changed` | box | The landing line's journal changed while the server read it, so nothing was changed. Try again. |
| `landing-journal-durability` | box | The server could not confirm its journal reached its disk, so the line stays stopped until the server replays the journal. |
| `landing-journal-append` | box | The server could not finish writing the journal. Whether it took effect is not known; the line is read again to show what stands. |
| `landing-db-unavailable` | box | The coordination database is not available, so the landing line was not read or changed. Try again in a minute. |
| `landing-db-apply` | box | The server wrote the journal but could not apply it. Whether it took effect is not known until the server replays its journal; the line is read again. |
| `landing-db-commit` | box | The server could not commit the change. Whether it took effect is not known until the server replays its journal; the line is read again. |
| `landing-fenced` | box | The landing line is stopped after an earlier write the server could not finish. It reads and changes nothing until the server replays its journal or restarts. |
| `landing-projection-unreadable` | project | A row of this project's landing line is damaged, and nothing was changed. A replay or a restart does not fix it; the row needs repair. |
| `landing-entry-exists` | box | That pull request already has an entry in the line, so nothing was changed. |
| `landing-entry-missing` | box | That pull request has no entry in this project's line any more, so nothing was changed. The line is read again. |
| `landing-after-missing` | box | An order named an entry that is not in the line, so nothing was changed. |
| `landing-after-cross-project` | box | An order named an entry of another project, so nothing was changed. |
| `landing-cycle` | box | That order would make entries wait on each other in a circle, so nothing was changed. |
| `landing-dependencies-unreadable` | box | An entry's order could not be read, so nothing was changed. |
| `landing-recovery-unresolved` | box | This entry's records are still being recovered, so it cannot be withdrawn yet. Nothing was changed. |
| `landing-identity-conflict` | box | Two records of this line claim the same entry, so nothing can be withdrawn until that is repaired. Nothing was changed. |
| `landing-id-overflow` | box | The line has run out of entry numbers, so nothing was changed. |
| `landing-sequence-overflow` | box | The landing journal has run out of sequence numbers, so nothing was changed. |
| `landing-entry-terminal` | box | That entry has already left the line: it landed, was closed or was withdrawn. Nothing was changed; the line is read again. |
| `landing-entry-moved` | box | That entry changed after this screen read it: it was pinned again. Nothing was withdrawn. The line is read again; look at it and confirm again if you still mean to. |
| `landing-project-unknown` | box | The landing line has never seen this project, so there is nothing to pause. Nothing was changed. |
| `landing-record-unparseable` | box | The server built a journal record its own reader refuses, so it wrote nothing. Nothing was changed; this is a server defect worth reporting. |
| `run-unreadable` | box | The run behind this entry could not be read, so the server could not tell who to notify and withdrew nothing. Try again in a minute. |
| `bad-request` | box | The server refused the request as malformed, so nothing was changed. This page and the server may be out of step; reload the page. |
| `not-configured` | absent | This box runs no coordination, so it has no landing line. |
| `unauthenticated` | box | Your sign-in has lapsed, so nothing was changed. Sign in again and retry. |

| Constant | Sentence |
|---|---|
| `UNKNOWN_WORD_TEXT(word)` | ``The server refused this with a word this page does not know (`${word}`). Nothing here assumes it worked; the line is read again.`` |
| `UNWORDED_TEXT(status)` | ``The server answered ${status} without a word this page can read. Nothing here assumes it worked; the line is read again.`` |
| `UNREACHABLE_READ_TEXT` | The server could not be reached, so the line was not read again. |
| `UNREACHABLE_WRITE_TEXT` | The server could not be reached or did not answer. |
| `OUTCOME_UNKNOWN_TAIL` | ` Whether this change took effect is not known; the line is read again to show what stands.` |
| `UNREADABLE_ANSWER_TEXT` | The server answered with a line this page cannot read. Reload the page; if it stays, this page and the server are out of step. |
| `STALE_PREFIX` | `Not read again: ` (before a box failure's sentence, over a line already drawn) |

**Notice words** (`landingNoticeText`; `#<pr>` is the withdrawn entry's for `landing-withdrawn`, the dependant's for `landing-held`, and `entry <id>` when `prOf` answers `null`):

| Outcome | Sentence |
|---|---|
| `queued`, `landing-withdrawn` | `Told <toId>, its coordinator.` |
| `queued`, `landing-held` | `Told <toId>, coordinator of #<pr>, which now waits on it.` |
| `none`, `unclaimed` | `No one to tell about #<pr>: its run has no coordinator.` |
| `none`, `unrecorded` | `No one to tell about #<pr>: no coordinator was recorded when it entered the line.` |
| `unreadable` | `Could not tell the coordinator of #<pr>: its run could not be read.` |

The kinds and reasons are read through `Record`s over `LandingNoticeOutcome['kind']` and its `reason` union, so a new member is a compile error.

**Line words:**

| Constant | Value |
|---|---|
| `LINE_TITLE` | `Landing line` |
| `STATUS_RUNNING(pr)` | `Next to land: #<pr>.` |
| `STATUS_NONE_READY` | `No entry can land yet.` |
| `PAUSE_BY_TEXT` (`Record<LandingPauseBy, string>`) | `operator`: `by you`; `main-red`: `because main is red` |
| `STATUS_PAUSED(by)` | `Paused ` + the `by` words joined with ` and `, in the read's order, + `. Nothing lands.` |
| `STATUS_HELD` | `Held: some of this line's records are being recovered. Nothing lands until they are.` (After `STATUS_PAUSED`, with one space, when the line is paused and held at once.) |
| `STATUS_RED_FIXES_MAIN(pr)` | `Main is red. Only #<pr>, which fixes main, may land.` |
| `ROLE_TEXT.head` | `next to land` |
| `ROLE_TEXT.in-line` | `in line` |
| `WAITS_TEXT(prs)` | `waits on ` + each `#<pr> (withdrawn)` joined with `, ` |
| `EJECTED_TEXT(kind)` | `sent back for a fix round` + (` (` + `EJECTION_TEXT[kind]` + `)` when `kind` is not `null`) |
| `EJECTION_TEXT` (`Record<LandingEjectionKind, string>`) | `dequeued`: `dequeued by the merge queue`; `new-head`: `its head moved`; `conflict`: `it conflicts with main` |
| `ROLE_TEXT.unknown` | `unreadable; set aside, and cannot be withdrawn from here` |
| `TAG_FIXES_MAIN` | `fixes main` |
| `TAG_NO_RUN` | `no run` |
| `PAUSE_LABEL` | `Pause line` / `Resume line`; busy: `Pausing…` / `Resuming…`; accessible name: `<label> for <project>` |
| `WITHDRAW_LABEL(pr, project)` | visible `Withdraw…`; accessible name `Withdraw #<pr> from <project>'s landing line` |

**Sheet words** (exact copy; it is section 9 block 3's truth for an operator who has not read it):

| Constant | Sentence |
|---|---|
| `SHEET_TITLE(pr)` | `Withdraw #<pr>?` |
| `SHEET_LEAVES(pr, project)` | `#<pr> leaves <project>'s landing line and will not land from it.` |
| `SHEET_FREES_NOTHING` | `Nothing that waits on it is freed. An entry declared after it keeps waiting until a session declares its order again without it, or until it comes back and then lands or is closed.` |
| `SHEET_DEPENDANTS(prs)` | `As this page read the line, these open entries wait on it directly: ` + `#<pr>` joined with `, ` + `.`; with none: `As this page read the line, no open entry waits on it directly.` |
| `SHEET_AS_READ` | `After you confirm, the server names everyone it told.` |
| `SHEET_TOLD` | `Its coordinator, and the coordinator of each entry that waits on it, are told by mail where one is recorded.` |
| `SHEET_COMES_BACK` | `It comes back if its run is pinned at merging again.` |
| `SHEET_NO_RUN` | `It has no run, so it cannot come back into the line.` |
| `SHEET_GITHUB` | `It does not stop a merge GitHub has already queued.` |
| `SHEET_CONFIRM(pr)` / busy | `Withdraw #<pr>` / `Withdrawing…`; the other button `Cancel` |
| `SHEET_DONE(pr)` | `Withdrawn: #<pr> is out of the line. Nothing that waited on it was freed.` |
| `SHEET_GONE(pr)` | `#<pr> is no longer in the line as last read, so there is nothing to withdraw.` |
| `SHEET_DONE_BUTTON` | `Done` |

**`pwa/src/fleet/landingLineView.ts`** imports types from `shared/landingLine.ts`, `LANDING_ENTRY_TERMINAL` and `isLandingEntryState` from it, the guard kit (`isRecord`, `isNum`) from `lib/wire.ts`, `sameJson` from `lib/sameJson.ts`, the type `PollOutcome` from `lib/usePoll.ts`, and `landingWords.ts`.

```ts
/** The wire guard: `{ok: true, ...LandingLineView}` with the fields the console reads, or `null`. Additive fields pass and are
 *  not kept: the answer it returns has no `binding` and no `recovery`, which the console does not draw. */
export function readLandingLine(raw: unknown): LandingLineView | null;

export type LandingRowRole = 'head' | 'waits' | 'in-line' | 'ejected' | 'unknown';
export interface LandingRow {
  entryId: number; pr: number; role: LandingRowRole; text: string; fixesMain: boolean; runless: boolean;
  /** `false` exactly for an `unknown` row (Q-B): the server refuses its withdrawal, so no `Withdraw…` is drawn. */
  withdrawable: boolean;
}
export type LandingStatus =
  | { kind: 'running'; headPr: number | null } | { kind: 'paused'; by: LandingPauseBy[]; held: boolean }
  | { kind: 'held' } | { kind: 'red-fixes-main'; headPr: number };
export interface LandingLineCard {
  project: string; status: LandingStatus; statusText: string; rows: LandingRow[];
  pauseLabel: string; pauseBusyLabel: string; pauseNext: boolean;
}
/** `null` when there is nothing to say: no open entry and no operator pause (Q2: main red alone says nothing). */
export function landingCardOf(view: LandingLineView): LandingLineCard | null;

export interface WithdrawPreview { entry: LandingEntry; dependants: { entryId: number; pr: number }[]; runless: boolean }
/** The entry as read and its DIRECT dependants as read (open entries whose `afterIds` name it); `null` when it is not open. */
export function withdrawPreviewOf(view: LandingLineView, entryId: number): WithdrawPreview | null;

export type LandingCardState =
  | { kind: 'none' }
  | { kind: 'line'; view: LandingLineView; card: LandingLineCard; stale: LandingFailure | null }
  | { kind: 'failed'; failure: LandingFailure };
/** One card's next state from its previous state and one read's outcome (D-9109). */
export function landingCardStateOf(prev: LandingCardState | undefined, outcome: PollOutcome): LandingCardState;
/** Equal when the card draws the same thing and the sheet would send and preview the same (m3): `card`, `stale` and the
 *  open entries' `id`, `pr`, `state`, `pinnedAt`, `runId` and `afterIds`, compared by `sameJson`; never the raw view. */
export function sameLandingState(a: LandingCardState, b: LandingCardState): boolean;
/** The card's part of `FleetCards`' view-hold key (F8): `''` for `none` or no state, `f` for `failed`, else the row count,
 *  with `s` after it while the stale sentence shows. */
export function landingLineHoldPart(state: LandingCardState | undefined): string;
```

The rules the tests pin:
- **Open entries:** the read's `entries`, less any whose state `LANDING_ENTRY_TERMINAL` marks terminal (an older server's `entries` were every entry).
- **Something to say:** at least one open entry, or `operatorPaused` (Q2 ruled). Main red with no open entry draws nothing: a project that opted out keeps a stored red flag (the README's trap paragraph), and every known project is read, so red alone would draw a lasting false pause. With an open entry, main red is said as the status rules below say it.
- **Rows:** first `order.order` in its own order, then every other open entry in `entries`' order. A row is `head` only when `order.paused` is false and its id is `order.head.id`. Otherwise a pinned row is `waits` when `order.waits` names it (its text from `on`'s PRs, in `on`'s order), else `in-line`. An `ejected` row is `ejected` and an `unknown` row `unknown`, whatever `order` says. `withdrawable` is `false` exactly for an `unknown` row, read from the entry's state word.
- **Status, first match:** `order.paused` → `paused` with `order.by`, and `held: true` when `order.held` is present too (its text is the pause sentence, then `STATUS_HELD`; m9); `order.held` present → `held`; `mainRedHold` and `order.head?.fixesMain` → `red-fixes-main`; else `running` with `order.head?.pr ?? null` (`STATUS_NONE_READY` when `null`).
- **The control:** `pauseNext = !operatorPaused`; the label is `Resume line` when `operatorPaused`, else `Pause line`. A line paused by main red alone still offers `Pause line`.
- **The withdraw preview** answers `null` for an entry that is not open, and for an `unknown` one.
- **The reducer:** a good answer with something to say is `line` with `stale: null`; a good answer with nothing to say is `none`. A raw answer the guard refuses, or a rejection, becomes `landingFailureOf(…, 'read')` (an unreadable answer becomes `UNREADABLE_ANSWER_TEXT`, scope `box`). Then: scope `absent` is `none`; a previous `line` keeps its view and card with that failure as `stale`; scope `project` is `failed`; anything else is `none`.

### 4.3 The calls (L3, `pwa/src/lib/api.ts`; Task 5)

```ts
landingLine: (project: string, opts?: ReadOpts) => getJson<unknown>(`/api/landing?project=${encodeURIComponent(project)}`, opts),
landingPause: (project: string, paused: boolean) =>
  postJson<{ ok: true } & LandingPauseAnswer>('/api/landing/pause', { project, paused }),
landingWithdraw: (project: string, pr: number, pinnedAt: number) =>
  postJson<{ ok: true } & LandingWithdrawAnswer>('/api/landing/withdraw', { project, pr, pinnedAt }),
```

The read answers `unknown`, because the view model's guard reads it; the doors' answers are typed, because the console uses only `notices`, `entry` and the re-read.

### 4.4 The hook (L4, `pwa/src/fleet/useLandingLines.ts`; Task 6)

```ts
export type LandingLineReader = (project: string, signal: AbortSignal) => Promise<unknown>;
export interface LandingLines { readonly states: ReadonlyMap<string, LandingCardState>; readonly reload: () => void }
/** One `usePoll` at `LANDING_LINE_POLL_MS` reads every card project's line, again on each return to the page (the default
 *  `refetchOnVisible`) and on `reload()`, which each door's answer calls. */
export function useLandingLines(args: { projects: readonly string[]; read?: LandingLineReader }): LandingLines;
export const LANDING_LINE_POLL_MS = 60_000;
```

- `read` defaults to `(p, signal) => api.landingLine(p, { signal })`.
- The request reads the **current** `projects` at call time (`usePoll` calls the latest request), de-duplicated and sorted, each in parallel, and settles each into a `PollOutcome`, so one project's failure never drops another's answer. Each read starts as `Promise.resolve().then(() => read(p, signal))`, so a reader that throws (a test that mocks `lib/api` without `landingLine`) settles as a rejection. The request itself never rejects.
- `onOutcome` runs `landingCardStateOf` per project and keeps the previous state object when `sameLandingState` says it is unchanged, so `ProjectCard`'s identity memo re-renders only the card whose line changed. A project that leaves the list leaves the map.
- There is no other trigger (Q1 ruled): no reload on a change of the runs or of the projects. A run reaching `merging`, or a new card, shows within a minute.
- `reload` is stable for the hook's life (`useCallback` over the poll control). A door's answer reloads every project: taps are rare, so there is no second path for one project (Q-A ruled).
- **N is every known project** (Q-A ruled), the review's 31 on the fleet box: N reads on mount, on each return to the page, every 60 seconds and after each door's answer, in parallel. Each is one synchronous read of the landing tables on the server and about 250 to 600 bytes, so 31 projects come to about 31 requests and 10 to 20 KB a minute. `usePoll`'s timer also runs while the page is hidden (a browser may throttle it).

### 4.5 The components (L4; Task 7)

```ts
// pwa/src/fleet/LandingLine.tsx
export type LandingPauser = (project: string, paused: boolean) => Promise<{ ok: true } & LandingPauseAnswer>;
export interface LandingLineProps {
  project: string; state: LandingCardState; onReload: () => void;
  /** The card's own `<section>`, focused when the block has gone (m7). */
  focusFallback: RefObject<HTMLElement | null>;
  pause?: LandingPauser; withdraw?: LandingWithdrawer;   // default api.landingPause, api.landingWithdraw
}
/** `null` only when the state draws nothing AND no sheet is open (F1). */
export function LandingLine(props: LandingLineProps): JSX.Element | null;

// pwa/src/fleet/LandingWithdrawSheet.tsx
export type LandingWithdrawer = (project: string, pr: number, pinnedAt: number) => Promise<{ ok: true } & LandingWithdrawAnswer>;
export interface LandingWithdrawSheetProps {
  /** The line as now read, or `null` once the line has nothing to say or could not be drawn (the entry has then gone). */
  project: string; view: LandingLineView | null; entryId: number; pr: number;
  onClose: () => void; onReload: () => void; withdraw?: LandingWithdrawer;
}
export function LandingWithdrawSheet(props: LandingWithdrawSheetProps): JSX.Element;
```

**`LandingLine`:**
- It holds one piece of state of its own, the open sheet: `{ entryId, pr } | null`.
- **The block.** `none` draws no block. `failed`: the block with its title and the failure's sentence in `role="alert"`, and no control. `line`: a `<section aria-label="Landing line of <project>">` with the title, the status sentence in `role="status"` (`aria-live="polite"`, so a re-read's change is announced), the stale sentence (`STALE_PREFIX` + text) when `stale` is set, the pause `Button` (`variant="quiet"`), and one row per `card.rows`: `#<pr>`, the role text, a `Chip` for each tag, and a `Withdraw…` `Button` (`variant="danger-ghost"`) only when the row is `withdrawable`.
- **The sheet outlives the block (F1).** While a sheet is open, `LandingLine` renders it whatever the state, passing `view` as the `line` state's view, or `null` when the state is `none` or `failed`. It returns `null` only when the state draws no block and no sheet is open. So withdrawing a line's only entry, a refusal on a line that the re-read reduces to nothing, and `landing-entry-terminal` on the last entry each leave the sheet up with its sentence until the operator closes it.
- **The pause tap:** busy label while in flight; on the answer, call `onReload()`; on a rejection, show `landingFailureOf(err, 'pause')`'s text in `role="alert"` under the control and call `onReload()`. The label never changes on the tap: it is `card.pauseLabel` until a read changes it. A generation ref drops an answer that lands after the component unmounts, as `LiftCapSheet` does.
- **Focus on close (m7),** to the first that is in the document: that row's `Withdraw…` button, else the block's pause button, else `focusFallback.current`, the card's `<section>`. It is moved in an effect after the sheet has unmounted, because the sheet primitive restores focus to its opener, which a re-read may have removed.

**`LandingWithdrawSheet`:**
- Phase `confirm`: `withdrawPreviewOf(view, entryId)` from the **current** `view` prop, so a re-read redraws it. With a preview: `SHEET_LEAVES`, `SHEET_FREES_NOTHING`, `SHEET_DEPENDANTS` and `SHEET_AS_READ`, `SHEET_TOLD`, `SHEET_COMES_BACK` or `SHEET_NO_RUN` (by `preview.runless`), `SHEET_GITHUB`. Footer: `Button variant="danger"` `SHEET_CONFIRM`, `Button variant="ghost"` `Cancel`. Without a preview (the entry has left the open entries, or `view` is `null`): `SHEET_GONE(pr)`, confirm disabled.
- Confirm sends `withdraw(project, preview.entry.pr, preview.entry.pinnedAt)`: the pin time the console read, never a clock value. The sheet keeps the view it confirmed from, for the answer's PRs.
- Answer: phase `done`, the title kept; `SHEET_DONE`, one list item per `notices` outcome (`landingNoticeText`, PRs from the view it confirmed from), and `SHEET_NO_RUN` or `SHEET_COMES_BACK` by `answer.entry.runId === null`. Footer: `Done`. Then `onReload()`. The done phase reads no later view, so a re-read that empties the line changes nothing in it.
- Rejection: phase `confirm` again, `landingFailureOf(err, 'withdraw')`'s text in `role="alert"` above the footer, and `onReload()`. Nothing in this branch says the entry was withdrawn. The confirm is not disabled while the re-read is in flight: a second confirm before it lands sends the old pin time, which the server refuses again (m10).
- No sign-in fact is read anywhere.

**The mount (F2: no identifier or string spelled `landing`):**
- `FleetCards`: `const landingLine = useLandingLines({ projects: tree.map((g) => g.project) });` and, on each `ProjectCard`, `landingLine={landingLine.states.get(g.project)}` and `onLandingLineReload={landingLine.reload}`.
- `FleetCards`' `holdKey` (F8): each card's part gains `~` and `landingLineHoldPart(state)` when that part is not `''`, so a key for a card without a block is byte-identical to today's (`programme-box-card.test.tsx` pins `project-c:-0`). The memo's dependencies gain `landingLine.states`.
- `ProjectCard`: two optional props, `landingLine?: LandingCardState` and `onLandingLineReload?: () => void`; a `useRef<HTMLElement>(null)` on its `<section>`, which gains `tabIndex={-1}` so the block's focus can fall back to it; and one line between `<ProjectCardHead … />` and the body: `{landingLine !== undefined && <LandingLine project={group.project} state={landingLine} onReload={onLandingLineReload ?? noop} focusFallback={cardRef} />}`. It sits outside the `!collapsed` body, so a folded card still shows its line.

## 5. What the operator will see

The fleet screen, phone width first. Every project the box knows has a card, whether or not anything runs in it. A card's landing block appears between the card's name row and its sessions, and only when the project's line has an open entry or you have paused it. A project whose line is empty shows no block at all, even while main is red. Everything is said in words; colour only repeats them. The block is read again every minute, whenever you come back to the page, and after each tap.

**A running line** (project-a, five open entries):

```text
┌ project-a ──────────────────────────────┐
│ Landing line              [ Pause line ] │
│ Next to land: #101.                      │
│  #101  next to land  fixes main          │
│                                [Withdraw…]│
│  #104  in line                 [Withdraw…]│
│  #107  waits on #103 (withdrawn)          │
│                                [Withdraw…]│
│  #102  sent back for a fix round          │
│        (its head moved)        [Withdraw…]│
│  #109  unreadable; set aside, and cannot │
│        be withdrawn from here            │
│  … the card's sessions …                 │
└──────────────────────────────────────────┘
```

The pinned entries come first, in the order the server says they may land; the entries sent back or unreadable follow. "Next to land" is only ever the entry the server named; it says which entry is next, not that it can land this minute. An unreadable entry has no `Withdraw…` button, because the server refuses to withdraw it. An entry with no run carries a `no run` tag.

**Paused by you:**

```text
│ Landing line             [ Resume line ] │
│ Paused by you. Nothing lands.            │
│  #101  in line                 [Withdraw…]│
```

**Paused because main is red** (the button still offers your own pause):

```text
│ Landing line              [ Pause line ] │
│ Paused because main is red. Nothing lands.│
```

**Paused by you and because main is red:** `Paused by you and because main is red. Nothing lands.`, with `Resume line`. Resuming lifts only your pause; the line stays paused while main is red, unless the next entry fixes main (then it reads as below).

**Main is red, and the next entry fixes it:** `Main is red. Only #101, which fixes main, may land.` with `#101  next to land  fixes main`.

**Held for recovery:** `Held: some of this line's records are being recovered. Nothing lands until they are.` Paused and held at once, the card says both, the pause first: `Paused by you. Nothing lands. Held: some of this line's records are being recovered. Nothing lands until they are.`

**Paused with no entries:** the title, `Paused by you. Nothing lands.` and `Resume line`, with no rows. Main red with no entries and no pause of yours shows nothing: a project that opted out of the line can keep a stored red flag, and a block there would be a false pause.

**After a tap on Pause line:** the button reads `Pausing…` until the server answers, then the line is read again, and only then does it say `Paused by you` and offer `Resume line`. A second quick tap changes nothing: the server answers that the line already is as asked.

**When the line could not be read again** (the server's landing journal is stopped, say): the card keeps the line it last read, with `Not read again: The landing line is stopped after an earlier write the server could not finish. …` under the status. A card that never had a line shows nothing. If one of the project's own rows is damaged, its card shows the title and `A row of this project's landing line is damaged, …` even if it showed nothing before.

**The withdraw sheet** (a sheet from the bottom on a phone, a centred dialog on a desktop):

```text
┌ Withdraw #104? ──────────────────────────┐
│ #104 leaves project-a's landing line and │
│ will not land from it.                   │
│ Nothing that waits on it is freed. An    │
│ entry declared after it keeps waiting    │
│ until a session declares its order again │
│ without it, or until it comes back and   │
│ then lands or is closed.                 │
│ As this page read the line, these open   │
│ entries wait on it directly: #107.       │
│ After you confirm, the server names      │
│ everyone it told.                        │
│ Its coordinator, and the coordinator of  │
│ each entry that waits on it, are told by │
│ mail where one is recorded.              │
│ It comes back if its run is pinned at    │
│ merging again.                           │
│ It does not stop a merge GitHub has      │
│ already queued.                          │
│ [ Withdraw #104 ]            [ Cancel ]  │
└──────────────────────────────────────────┘
```

For an entry with no run, `It has no run, so it cannot come back into the line.` replaces the line about coming back. With nothing waiting on it: `As this page read the line, no open entry waits on it directly.`

**The sheet's outcomes:**
- **Withdrawn:** `Withdrawn: #104 is out of the line. Nothing that waited on it was freed.`, then one line per notice, for example `Told lane-a-project-a, its coordinator.` and `Told lane-b-project-a, coordinator of #107, which now waits on it.`, or `No one to tell about #107: its run has no coordinator.`, or `Could not tell the coordinator of #107: its run could not be read.` Then the line about coming back, and `Done`. The sheet stays until you tap `Done`, even when #104 was the line's only entry and the block behind it has gone. The card behind it is read again and shows `#107  waits on #103 (withdrawn), #104 (withdrawn)` (in this example `#107` was declared after both).
- **The entry changed meanwhile:** `That entry changed after this screen read it: it was pinned again. Nothing was withdrawn. The line is read again; look at it and confirm again if you still mean to.` The sheet stays open and redraws from the new read. A confirm tapped before the new read arrives is refused the same way.
- **It already left the line:** `That entry has already left the line: … Nothing was changed; the line is read again.` The sheet then says `#104 is no longer in the line as last read, so there is nothing to withdraw.`, with the confirm button off, and stays until you close it, even if the line now has nothing else to show.
- **Its records are being recovered:** `This entry's records are still being recovered, so it cannot be withdrawn yet. Nothing was changed.`
- **The server could not be reached:** `The server could not be reached or did not answer. Whether this change took effect is not known; the line is read again to show what stands.`
- **A word this page does not know** (a newer server): ``The server refused this with a word this page does not know (`…`). Nothing here assumes it worked; the line is read again.``

When the sheet closes, focus goes back to the row's `Withdraw…` button, or, if that row has gone, to the line's pause button, or, if the whole block has gone, to the project's card.

With sign-in off, everything above is the same: no warning is added.

## 6. `CLAUDE.md` and README lines

**`CLAUDE.md`: no line changes.** The wave adds no route, door, credential, verb, file under `~/.ccrc` or SAFETY rule, and the box-token bullet already names both doors and the read.

**README: one block** (Task 7), after the doors' sentence. Old (checked once in `README.md` at the baseline):

```text
entry re-enters at its run's next verified pin and then lands or is closed; a run-less entry cannot re-enter (D-9047).
```

New:

```text
entry re-enters at its run's next verified pin and then lands or is closed; a run-less entry cannot re-enter (D-9047). Since wave 5k
the console draws the line on the fleet screen's project card, only for a project whose line has an open entry or the operator's
pause: each open entry by pull request in the read's order, which one is next to land, what waits and on which withdrawn entry, and
why the line is paused. It reads `GET /api/landing` for every known project, every 60 seconds, when the page is shown again and after
each door's answer (D-9108). Pause and resume are one tap; a withdrawal is a sheet that sends the pin time the console read and then
names who was told and who could not be.
```

No test on `origin/main` reads the replaced sentence's end. `landing-entry-census.test.ts`'s journal phrases sit in other paragraphs.

## 7. Tests by layer

- **Pure (pwa vitest):** `pwa/test/landing-words.test.ts` and `pwa/test/landing-line-view.test.ts`.
- **Hook and components (pwa vitest, jsdom):** `pwa/test/use-landing-lines.test.tsx`, `pwa/test/landing-line.test.tsx`, `pwa/test/landing-withdraw-sheet.test.tsx`, `pwa/test/landing-line-hold.test.tsx`, and new cases in `pwa/test/project-card.test.tsx`.
- **Browser:** `pwa/browser/landing-line.browser.test.ts`, on `pwa/browser/abandon-sheet.browser.test.ts`'s pattern (`openApp`, `serveDist`, an `AppFixture`), at 360, 390, 1280, 1470 and 1920 px, both skins (Instrument in its project mode), light and dark. The shared fixture answers one body per path, so each case that needs a per-project answer, a changed read, a 409 answered once or a recorded body registers its own `ctx.route` handler, as `pwa/browser/archive-claims-sheet.browser.test.ts` does; `pwa/browser/app.ts` is not extended (F4).
- **Server:** Task 1's and Task 2's files.

**Accessibility checks.** The PWA has no stories; `ui/` gains none, because no primitive is added (the advisory `storybook-a11y` job is unchanged). The checks are:
- Component cases: the block is a named region (`Landing line of <project>`); the status sentence is in `role="status"`; each failure is in `role="alert"`; every button's accessible name says which project and which PR; the sheet is a `dialog` named by its title; every row's state is in its text, never only in a colour or a class.
- Browser cases, at every width, skin and theme: every control's box is at least `--tap-min` (44px) tall; nothing in the card overflows horizontally at 360 px; opening the sheet moves focus into it and closing it returns focus to the `Withdraw…` button it came from (the `confirm-focus` pattern); the focus ring of each control lies inside the viewport.
- The colour pairs: each class in `landing-line.css` that sets a colour sets its ground with it, from tokens only, so `pwa/test/utility-pairs.test.ts` and `pwa/test/contrast.test.ts` measure it.

**The gate.** A pull request's fast run skips the browser suite, and the merge queue runs it. So before the wave-done the builder runs the **whole** browser suite locally through `ccrc test`, with the box's existing Chrome (`CCRC_CHROME`), never a browser installed into the shared cache.

## Global Constraints

- **The console decides nothing about the line.** No head, order, pause state or wait is computed from anything but the read's own fields; the only edge the console reads itself is the sheet's preview of direct dependants, labelled as read.
- **Decide in L1, act in L4.** Components branch on view-model fields only, never on a refusal code, a status number or a sign-in fact.
- **One poll primitive, one timer:** one `usePoll` with `LANDING_LINE_POLL_MS = 60_000` (Q1 ruled). No second `usePoll`, `setInterval`, store, cache key or browser storage, and no identifier or string spelled `landing` in `pwa/src`.
- **Tokens only, no new colour, no new primitive;** `@ccrc/ui`'s `Sheet`, `Button` and `Chip` as they are. Phone width first.
- **Wire:** additive only; the console tolerates an older answer without `waits`, `entriesScope`, `binding` or `recovery`. No route, migration, `ccd` verb or client verb. `FLEET_PROTO` stays 1.
- **Growth:** `pwa/src/lib/api.ts` at or under 40 net code lines; `pwa/src/fleet/fleet.css` untouched.
- **Neutral names only** in fixtures, notes, commits and the pull request: `project-a`, `lane-a`, `the fleet box`. Cite code as `file#symbol` or `file#@anchor`.
- **Every test and typecheck runs through `ccrc test -- <command>`,** in the foreground, tool timeout at least 600000 ms, `--maxWorkers=2`, one file per process for the census suites. Server suites run cd'd in `server/`, pwa suites in `pwa/` (`ui/` installed first).
- **Claims and packets.** Read `GET /api/claims?project=ccrc-pwa` before each task and claim every path it edits. For a held file, send its holder a unified diff against a named `main` commit, inline, with its size and sha256, and leave the file untouched until the answer.
- **Commits** on the workspace's own branch; push once, when the wave is complete; the pull request stays a draft. Task notes go under `docs/superpowers/programs/landing-order/` as `wave5k-task-<n>.md`; never edit an existing plan or the programme ledger. A commit that needs a `Ledger-Edit` line keeps it in the last paragraph with the co-author line, read back with `git interpret-trailers --parse` before the push.
- **Deviation numbers are issued, never chosen.** This plan defines D-9107 to D-9110. A departure found while building is named by slug (`D-TBD-<slug>`) in the wave-done.

## Review Focus

1. **A head or a pause the read did not say:** with the line paused, held, both, or red with a fixing head, no row says `next to land` unless it is `order.head`, and no status says running while `order.paused` is true (Task 4's cases, rows M1, M2, M24, M31, M43).
2. **A withdrawal of something other than what the operator saw:** the sheet sends the `pinnedAt` of the view it shows, redraws from each new read, and a confirm sent before the re-read lands is refused again by the server; an `unknown` row offers no withdrawal (Task 7's cases, rows M4, M12, M26, M37; the browser cases' own routes).
3. **A refusal, an unknown outcome or a result lost:** every rejected door call leaves a sentence in `role="alert"` and no "Withdrawn"; an unreachable write and the three possibly-applied words say the outcome is not known; the sheet and its result outlive a line that the re-read empties (Tasks 3 and 7, rows M5, M10, M11, M33, M38, M42).
4. **Noise on cards with nothing to say:** a box-wide read failure, `not-configured`, an empty line and main red alone draw nothing on a card that had no line, on every known project's card (Task 4's reducer cases, rows M7, M15, M17, M41).
5. **A fleet screen that re-renders, re-reads or jumps too much:** one read per project per tick, page return or door answer; an unchanged line (the binding's times included) keeps its state object; and a block that appears, grows or goes is in the view-hold key (Task 6's, Task 4's and Task 7's cases, rows M19, M20, M25, M39).

## What this does not claim

- **The line can be up to a minute old.** A change (main turning red or green, a coordinator's order, a run reaching `merging`, a run-less entry, a landing the landed reader finds) shows at the next 60-second read, the next return to the page or the next door answer.
- **"Next to land" names the entry the server's order puts first, not that the lander can take it now.** The binding, which says whether it can, is not shown (Q3 ruled); `ccrc-api landing show` gives it.
- **The read fans out over every known project** (Q-A ruled): N reads every minute, about 31 on the fleet box. If N grows large, the remedy is one server read that lists every line, which is a server wave's and is not built here.
- **The sheet's list of dependants is a preview.** It holds the open entries, as read, whose `afterIds` name the entry; an entry whose order does not read is not listed, while the server's notices, shown after the answer, are authoritative.
- **Instrument's status mode shows no landing line,** because it draws no project cards. The line is on the card in Refined and in Instrument's project mode.
- **Main red with no open entry and no operator pause is not drawn** (Q2 ruled), so a line the operator has not paused shows red only once it has an entry.
- **An `unknown` row cannot be withdrawn from the console** (Q-B ruled); the server refuses it until the row is repaired or re-pinned.
- **The recovery subjects and each entry's base and run are not shown.** The coordinator reads them with `ccrc-api landing show`.
- **A box-wide read failure is not drawn on a card that never had a line,** so a line paused while the journal was stopped stays unseen until a read succeeds.
- **Releasing a held dependant is not a console act.** It is a session's order declaration, as the 5j plan rules.
- **The PWA ships with the server,** so the console never meets a server without the session read; an older server's 401 would raise the sign-in screen.

---

## Wave 5k — the console (Tasks 1 to 8, one pull request)

### Task 1: the carries from wave 5j (server, its own commit)

**Files:** Modify `server/test/landing-subtractive.test.ts`, `server/src/coord/landingWrites.ts` (header comment only), `server/test/landing-doors-route.test.ts` (one comment), `server/test/landing-writes-act.test.ts`, `server/test/landing-writes.test.ts`.

**Interfaces:** Produces nothing later tasks use.

- [ ] **Step 1: The table census case** in `landing-subtractive.test.ts`, named `the table list is every landing table the schema creates`. It opens `world('run-bound')` and asserts that `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'landing\_%' ESCAPE '\' ORDER BY name`, mapped to names, equals `[...TABLES].sort()`. The `type = 'table'` filter leaves out the two `landing_*` indexes. Run green on the baseline (seven and seven).
- [ ] **Step 2: Two comments.**
  - `landingWrites.ts`'s first two lines. Old:
    ```text
    // L1, context C4 (landing order wave 5f). PURE: no clock, no fs, no store, no I/O; every import is a type
    // except the shared landing vocabulary's terminal map (D-9093). The
    ```
    New:
    ```text
    // L1, context C4 (landing order wave 5f). PURE: no clock, no fs, no store, no I/O; every import is a type except
    // those from the shared landing vocabulary, `shared/landingLine.ts`, the one file the purity case admits a value
    // import from (D-9093; the wave 5j plan's section 13, C12). The
    ```
  - `landing-doors-route.test.ts`, the comment above the spied-writer case. Old:
    ```text
      // writer is spied to answer each word once. No seam in source; the route's status and word are what is pinned.
    ```
    New:
    ```text
      // writer is spied to answer each word on every call, so both doors meet it in one case. No seam in source; the route's
      // status and word are what is pinned.
    ```
- [ ] **Step 3: The withdrawal event's run arm,** a case in `landing-writes-act.test.ts`: a withdraw whose result's `coordinator` is `{ kind: 'run', runId: 7, … }` raises the event with `runId: 7` and `sessionId: ''`. Run green.
- [ ] **Step 4: The time formatter's boundaries,** a case in `landing-writes.test.ts` through `landingWithdrawNoticesOf`'s entry body: for `at` of `0`, `Date.UTC(2024, 1, 29, 23, 59, 59, 999)`, `Date.UTC(2000, 2, 1)`, `Date.UTC(2100, 2, 1)` and `Date.UTC(2026, 11, 31, 23, 59, 59, 999)`, the body contains `` `at ${new Date(at).toISOString()},` ``. The test may use `Date`; the source may not. Run green.
- [ ] **Step 5: Rows C1 to C7** (section 8), each measured red and restored from a saved copy with its sha256 checked.
- [ ] **Step 6: Run** from `server/`, one file per process: `landing-subtractive`, `landing-writes`, `landing-writes-act`, `landing-doors-route`, `citations`, `anchors`. Green. Commit: `test(landing): the carries from wave 5j's reviews (wave 5k, D-9110)`

### Task 2: the door answers in L0

**Files:** Modify `shared/landingLine.ts`, `server/src/coord/landingWrites.ts` (the two write types). Test: the server typecheck and the pwa typecheck; `server/test/landing-doors-route.test.ts` and `server/test/landing-writes-act.test.ts` unchanged and green.

**Interfaces:** Produces `LandingPauseAnswer` and `LandingWithdrawAnswer` (section 4.1).

- [ ] **Step 1:** Add the two interfaces; re-express the two ok arms over them (section 4.1). No route changes.
- [ ] **Step 2: Run** the server typecheck (`ccrc test -- npx tsc --noEmit` in `server/`, and `-p test/tsconfig.tests.json`), `landing-doors-route`, `landing-writes-act`, `single-definition/` whole, `rings/` whole. Green. Commit: `refactor(landing): the doors' answers are declared once, in the shared vocabulary (wave 5k, D-9107)`

### Task 3: the words

**Files:** Create `pwa/src/fleet/landingWords.ts`. Test: `pwa/test/landing-words.test.ts`. Modify the spec's C5 row (section 9's pattern) for this file.

**Interfaces:** Produces section 4.2's words half.

- [ ] **Step 1: Failing cases.**
  - Every word in `LANDING_INFRASTRUCTURE_CODES`, `LANDING_MUTATION_CODES` and the four route words has a sentence that is non-empty, ends with a full stop, does not contain its own word, and differs from every other word's sentence; `landing-projection-unreadable` is `project`, `not-configured` `absent`, every other `box`; `mayApply` is `true` for exactly the three words of section 4.2.
  - `LANDING_ROUTE_TEXT` has exactly `LANDING_ROUTE_WORDS`' keys, each with its text.
  - Each sentence of section 4.2's table, byte for byte (one `it.each` over the table).
  - `landingFailureOf`: a known word answers its text; `outcomeUnknown` is `true` for `landing-db-commit` on `withdraw` and `pause` and `false` on `read`, and `false` for `landing-entry-moved` on every door; an unknown word answers `UNKNOWN_WORD_TEXT` naming it, with `OUTCOME_UNKNOWN_TAIL` on a write at 500 and above and never on a read; an `ApiError` with a non-object body answers `UNWORDED_TEXT` with its status; a plain `Error` answers the unreachable sentence, with the tail on `pause` and `withdraw` and not on `read`.
  - `landingNoticeText`: each kind and reason, a dependant's PR from `prOf`, and `entry <id>` when `prOf` answers `null`.

  Run red.
- [ ] **Step 2: Implement** `landingWords.ts`. Read the text through `refusalText(err, LANDING_ROUTE_TEXT)` and the scope and `mayApply` through `Object.hasOwn` on the same word; no literal comparison.
- [ ] **Step 3: Run** `landing-words`, `refusal-literal-ratchet`, the pwa typecheck, and from `server/` `rings/pwa-rings`, `rings/totality`. Green. Commit: `feat(landing): the console's words for the line and its doors (wave 5k)`

### Task 4: the view model

**Files:** Create `pwa/src/fleet/landingLineView.ts`. Test: `pwa/test/landing-line-view.test.ts`. Modify the spec's C5 row for this file.

**Interfaces:** Consumes Task 3. Produces section 4.2's view-model half.

- [ ] **Step 1: Failing cases,** each over a `LandingLineView` literal of `project-a`:
  - **Guard:** a real answer passes and its result has no `binding` and no `recovery` key; one with `waits`, `binding`, `recovery` and `entriesScope` absent passes; `ok` missing, an entry with a state outside `LANDING_ENTRY_STATES`, a non-array `entries` and a non-boolean `operatorPaused` each answer `null`.
  - **Nothing to say:** no entries and both flags off → `null`; no entries and `mainRedHold` alone → `null` (Q2); a read whose only entries are terminal (an older server) → `null`.
  - **Running:** five entries as section 5's first sketch: rows in `order.order` then entries order; only `order.head` is `head`; `#107`'s text is `waits on #103 (withdrawn)`; an ejected row with kind `new-head` reads `sent back for a fix round (its head moved)`; a row with `runId: null` has `runless`; the `unknown` row reads `unreadable; set aside, and cannot be withdrawn from here` with `withdrawable: false`, and every other row `withdrawable: true`. A literal that also lists the ejected and unknown entries in `order.order` (an inconsistent read) still gives them their own roles.
  - **Paused by you, by main red, by both** (`by` in the read's order): status text exact; no row is `head`; `pauseLabel` is `Resume line` only when `operatorPaused`.
  - **Held:** `order.held` set, `order.head` null, `order.order` non-empty: status `held`, no `head` row. Held with `mainRedHold` and a literal fixing head: still `held`. Paused by you and held: the pause sentence then `STATUS_HELD`, exactly.
  - **Red with a fixing head:** `mainRedHold` true, `order.paused` false, `order.head.fixesMain` true: `red-fixes-main` and its text.
  - **Paused by you, no entries:** a card with no rows.
  - **`withdrawPreviewOf`:** direct dependants only (a dependant of a dependant is not listed), each with its PR; `runless`; `null` for an id not open and for an `unknown` entry.
  - **`sameLandingState`:** two reads that differ only in the binding's `landerAt`, `probeAt` and `healthAt` are equal; two that differ in one entry's `pinnedAt` are not.
  - **`landingLineHoldPart`:** `''` for `undefined` and `none`, `f` for `failed`, `5` for section 5's first line, `5s` for it stale.
  - **`landingCardStateOf`:** a good answer to `line`; nothing to say to `none`; a box failure over a previous `line` keeps it with `stale`; a box failure with no previous line to `none`; `landing-projection-unreadable` with no previous line to `failed`; `not-configured` over a previous `line` to `none`; an unreadable raw over a previous `line` keeps it with `UNREADABLE_ANSWER_TEXT`.

  Run red.
- [ ] **Step 2: Implement** section 4.2's rules.
- [ ] **Step 3: Run** `landing-line-view`, the pwa typecheck, and from `server/` `rings/pwa-rings`, `rings/totality`, `rings/pwa-one-owner`. Green. Commit: `feat(landing): the console's view of one project's line (wave 5k)`

### Task 5: the calls

**Files:** Modify `pwa/src/lib/api.ts`. Test: the pwa typecheck; `growth-check` from `server/`.

- [ ] **Step 1:** Add section 4.3's three entries to the `api` object, beside the other coordination calls, and their type imports.
- [ ] **Step 2: Run** the pwa typecheck and `growth-check`. Green. Commit: `feat(landing): the console's calls to the line and its doors (wave 5k)`

### Task 6: the hook

**Files:** Create `pwa/src/fleet/useLandingLines.ts`. Test: `pwa/test/use-landing-lines.test.tsx`. Modify the spec's C5 row for the new file.

**Interfaces:** Consumes Tasks 4 and 5. Produces section 4.4.

- [ ] **Step 1: Failing cases,** with a fake `read` that counts calls per project and answers per project, under Vitest's fake timers:
  - On mount, exactly one read per distinct project (`['project-b', 'project-a', 'project-a']` reads two).
  - A re-render with the same projects reads nothing; after `60_000` ms every project is read once more, and not before (`59_999` ms reads nothing).
  - A new project in the list is read at the next tick, and its state appears then; a project that leaves the list leaves the map.
  - A return to the page reads every project once (raise the page clock's visible event as `usePoll`'s own tests do).
  - A reader that throws synchronously settles as that project's failure, and the other project still gets its `line`.
  - One project's rejection leaves the other's `line` in place.
  - A second answer equal under `sameLandingState` keeps the same state object (`toBe`), including two answers that differ only in the binding's times; a changed answer replaces only that project's object.
  - `reload()` reads every project once and keeps its identity across renders.
  - Unmounting aborts the reads in flight (the fake sees its signal aborted).

  Run red.
- [ ] **Step 2: Implement** section 4.4 on `usePoll`.
- [ ] **Step 3: Run** `use-landing-lines`, the pwa typecheck, and from `server/` `rings/pwa-one-owner`, `census-w7/pwa`, `rings/totality`. Green. Commit: `feat(landing): one read of each card's line on the one poll primitive (wave 5k, D-9108)`

### Task 7: the line, the sheet and the mount

**Files:** Create `pwa/src/fleet/LandingLine.tsx`, `pwa/src/fleet/LandingWithdrawSheet.tsx`, `pwa/src/fleet/landing-line.css`. Modify `pwa/src/fleet/FleetCards.tsx`, `pwa/src/fleet/ProjectCard.tsx`, `README.md` (section 6's block), the spec's C5 row for the three new files. Test: `pwa/test/landing-line.test.tsx`, `pwa/test/landing-withdraw-sheet.test.tsx`, `pwa/test/landing-line-hold.test.tsx` (new), `pwa/test/project-card.test.tsx`.

**Interfaces:** Consumes Tasks 3 to 6. Produces section 4.5. The prop and local are `landingLine` and `onLandingLineReload` everywhere, tests included: `rings/pwa-one-owner` counts every identifier and string spelled `landing` in `pwa/src` (F2).

- [ ] **Step 1: Failing component cases** (Testing Library; the calls are fakes passed as props).
  - **`LandingLine`:** `none` renders nothing; a `line` renders the named region, the status in `role="status"`, each row's text, a `fixes main` and a `no run` chip where the card says so; the `unknown` row has no `Withdraw…` button and every other row has one; a `stale` line shows `Not read again: ` and the failure; `failed` shows the alert and no button.
  - **The pause tap:** `Pause line` calls `pause('project-a', true)` once, shows `Pausing…`, and on the answer calls `onReload` once; the label stays `Pause line` until a new `state` with `operatorPaused` true is passed, then reads `Resume line`, whose tap sends `false`. A rejection with `landing-project-unknown` shows its sentence in `role="alert"`, never a changed label, and calls `onReload`. Unmounting before the answer lands calls nothing and sets no state (the generation ref).
  - **The sheet, confirm:** every sheet sentence of section 4.2 for a run-bound entry with one dependant; `SHEET_NO_RUN` and `As this page read the line, no open entry waits on it directly.` for a run-less entry with none; the confirm calls `withdraw('project-a', 104, <the view's pinnedAt for #104>)` exactly.
  - **The sheet, answer:** `SHEET_DONE`, one item per notice in `landingNoticeText`'s words, `SHEET_NO_RUN` when `answer.entry.runId` is `null`, `Done`, and `onReload` once.
  - **The sheet, refusals:** `landing-entry-moved` keeps the confirm phase, shows its sentence, calls `onReload`, and when a new `view` with a new `pinnedAt` arrives, the next confirm sends the new one; `landing-entry-terminal` followed by a `view` without the entry shows `SHEET_GONE` with the confirm disabled; an unknown word shows `UNKNOWN_WORD_TEXT`; a plain `Error` shows the unreachable sentence with `OUTCOME_UNKNOWN_TAIL`. In none of these does `Withdrawn:` appear.
  - **The sheet outlives the line (F1),** through `LandingLine` with a line of ONE entry: withdraw it, then pass `state: none` (the re-read); the sheet still shows `SHEET_DONE` and the notices, and after `Done` nothing renders and focus is on `focusFallback`'s node. The same line answering `landing-entry-terminal`, then `state: none`: the sheet shows the refusal's sentence and `SHEET_GONE` with the confirm disabled, until it is closed. A refusal (`landing-recovery-unresolved`) followed by `state: none`: the sentence stays up.
  - **Focus on close (m7):** with the row still drawn, focus returns to its `Withdraw…`; with the row gone and the block drawn, to the pause button; with the block gone, to the fallback node.
  - **Accessibility:** the names section 7 lists; the sheet is a `dialog` named `Withdraw #104?`.
  - **`project-card.test.tsx`:** a card given a `line` state draws the region between its head and its body; a collapsed card still draws it; a card given `none` or no `landingLine` draws none; the card's section has `tabIndex` `-1`.
  - **`landing-line-hold.test.tsx`** (F8), on `programme-box-card.test.tsx`'s pattern (`useHoldView` mocked to record its key) with `useLandingLines` mocked to answer fixed states: a card with section 5's first line has `~5` in its part of the key, then `~5s` once its state is stale; a card with no block keeps exactly today's part.

  Run red.
- [ ] **Step 2: Implement** section 4.5, with `landing-line.css` imported by `LandingLine.tsx`: a grid row of `auto 1fr auto` that wraps the role text under the PR at phone width; tokens only; each colour with its ground. The sheet's error class is this file's own, not `fleet.css`'s `abandon-error`.
- [ ] **Step 3: Mount** in `FleetCards` and `ProjectCard` (section 4.5), with the hold key's landing part. Check `pwa/test/line-props.test.ts` and `pwa/test/programme-box-card.test.tsx` still hold: the two new props compare by identity, and a card with no block keeps its exact key. A test file that renders `FleetCards` with `lib/api` mocked gets the hook's thrown read as a failure, so its cards draw no block.
- [ ] **Step 4: README** section 6's block, byte for byte.
- [ ] **Step 5: Run** `landing-line`, `landing-withdraw-sheet`, `landing-line-hold`, `project-card`, `line-props`, `programme-box-card`, `refusal-literal-ratchet`, `fleet-css`, `css-vars`, `utility-pairs`, `contrast`, `hover-states`, `focus-ring`, `design-system-boundary`, the pwa typecheck; from `server/` `rings/` whole, `census-w7/pwa`, `growth-check`. Green. Commit: `feat(landing): the line on the project card, its pause control and the withdraw sheet (wave 5k)`

### Task 8: the browser suite, the mutation rows, the gate

**Files:** Create `pwa/browser/landing-line.browser.test.ts`.

- [ ] **Step 1: The browser cases,** at every width, skin and theme of section 7. Each case that needs a per-project answer, a changed read, a 409 answered once or a recorded body registers its own `ctx.route` handler for `**/api/landing**`, as `pwa/browser/archive-claims-sheet.browser.test.ts` does for its 409; the shared fixture in `pwa/browser/app.ts` is not extended (F4). The handler answers `project-a` with section 5's five entries and a second project with an empty line, and records each POST body.
  - the second project's card has no landing region;
  - the first card's block shows `Next to land: #101.`, every row's text, and no `Withdraw…` on `#109`;
  - no horizontal overflow in the card at 360 px, and every control at least 44 px tall;
  - `Pause line`: the handler records one `POST /api/landing/pause` with `{project: 'project-a', paused: true}`, answers it, then answers the next read paused; only then does the button read `Resume line`;
  - `Withdraw…` on `#104`: focus moves into the dialog; confirm records one `POST /api/landing/withdraw` whose `pinnedAt` equals the read's value for `#104`; the answer's notices are listed; `Done` closes the sheet and focus returns to that row's `Withdraw…`;
  - a handler answering `landing-entry-moved` once: the sentence shows, a read follows, and the next confirm sends the new `pinnedAt`;
  - **the only entry (F1):** a project whose line holds one entry; withdraw it, and the handler's next read answers an empty line; the sheet still shows `Withdrawn:` and the notices; `Done` closes it, the block is gone, and focus is on the project's card. The same project answering `landing-entry-terminal`: the sentence and `SHEET_GONE` stay until the sheet is closed.
- [ ] **Step 2: The mutation rows** M1 to M43 (section 8), each measured red and restored from a saved copy with its sha256 checked.
- [ ] **Step 3: The gate,** one file per process:
  - pwa: every test file named in Tasks 3 to 7, then the **whole** pwa suite (`ccrc test -- npx vitest run --maxWorkers=2`), then the **whole** browser suite (`ccrc test -- env CCRC_CHROME=<the box's Chrome> ./node_modules/.bin/vitest run --config vitest.browser.config.ts`), and the pwa typecheck and build.
  - server: Task 1's files, `rings/` whole, `census-w7/pwa`, `single-definition/` whole, `growth-check`, `citations`, `anchors`, `topology-clean`, `typecheck-tests`, `ci-reach`, `deviation-refs` (after `git fetch origin main`), and the server typecheck.
  - `typecheck-tests` and `deviation-refs` have failed for the test box's own reasons before: re-run one alone, once with `ccrc test --local`, before calling it a break, and report both.
- [ ] **Step 4: Commit, push once, wave-done.** `test(landing): the console's line, pause and withdraw in the browser (wave 5k)`. The wave-done waits for the pull request's fast run on the exact tip, and says that the whole browser suite ran locally, with its count.

## 8. Mutation table

Each row is one change to the built code, measured red by the named test, then restored. "C" rows are Task 1's, "M" rows Task 8's.

| id | Mutation | Predicted red |
|---|---|---|
| C1 | `TABLES` loses `'landing_intents'` | `landing-subtractive`'s table census case |
| C2 | the schema's newest landing migration also creates a table `landing_mutant (id INTEGER)` | `landing-subtractive`'s table census case |
| C3 | the pause arm of `landingMutationNotice` raises `runId: 0` instead of `null` | `landing-writes-act`'s pause case (exact event) |
| C4 | the withdraw arm raises `sessionId: command.actor` instead of `''` | `landing-writes-act`'s withdraw case |
| C5 | the withdraw arm raises `runId: null` for a run-bound coordinator | Task 1 Step 3's run-arm case |
| C6 | `isoOf`'s day arithmetic is changed so a non-leap century year gains 29 February (the builder records the exact old and new text) | Task 1 Step 4's `2100-03-01` value |
| C7 | `isoOf` pads milliseconds to two digits | Task 1 Step 4's values whose milliseconds are below 100 (`0`, `2000-03-01`, `2100-03-01`); the existing `.007` case. The `.999` values stay green |
| M1 | `landingCardOf` marks `order.order[0]` as `head` when `order.head` is absent (a head the read did not name) | `landing-line-view`'s paused and held cases |
| M2 | the status ignores `order.paused` and reads `operatorPaused` alone (a paused line shown as running) | `landing-line-view`'s main-red pause case |
| M3 | a `waits` row's text drops its targets' PRs (a wait without its target) | `landing-line-view`'s running case (exact text) |
| M4 | the sheet sends `Date.now()` as `pinnedAt` (the withdraw sent without the read's pin time) | `landing-withdraw-sheet`'s confirm case; the browser withdraw case |
| M5 | the sheet's rejection handler moves to `done` (a refusal shown as success) | `landing-withdraw-sheet`'s refusal cases |
| M6 | `LANDING_ROUTE_WORDS` loses `'landing-entry-moved'` (a code with no sentence) | the pwa typecheck; `landing-words`' every-word case |
| M7 | `landingCardOf` answers a card for an empty, unpaused line (a line drawn with nothing to say) | `landing-line-view`'s nothing-to-say case; the browser second-project case |
| M8 | the pause control flips its label on the answer, not on the read | `landing-line`'s pause case; the browser pause case |
| M9 | the pause control always sends `paused: true` | `landing-line`'s resume case |
| M10 | `landingFailureOf` answers `''` for an unknown word (silence) | `landing-words`' unknown-word case |
| M11 | an unreachable write is answered without `OUTCOME_UNKNOWN_TAIL` | `landing-words`' plain-error case; the sheet's unreachable case |
| M12 | the sheet's rejection path skips `onReload` | `landing-withdraw-sheet`'s moved case; the browser moved case |
| M13 | `landingNoticeText` words a `none` outcome as `Told …` | `landing-words`' notice cases |
| M14 | the done view never says `SHEET_NO_RUN` | `landing-withdraw-sheet`'s run-less answer case |
| M15 | the reducer turns a box failure with no previous line into `failed` | `landing-line-view`'s box-failure case |
| M16 | the reducer turns `landing-projection-unreadable` into `none` | `landing-line-view`'s projection case |
| M17 | `not-configured`'s scope becomes `box` | `landing-words`' scope case; `landing-line-view`'s not-configured case |
| M18 | the reducer drops the previous line on a failure | `landing-line-view`'s stale case |
| M19 | the hook reloads on every render | `use-landing-lines`' re-render case |
| M20 | the hook compares the raw view with `sameJson` (so the binding's times make every read new) | `use-landing-lines`' identity case over two reads that differ only in the binding's times; `landing-line-view`'s `sameLandingState` case |
| M21 | the hook polls with its own `setInterval` and an `api.*` call | `rings/pwa-one-owner`'s request-poll case |
| M22 | `landingLineView.ts` imports `lib/api.ts` at runtime | `rings/pwa-rings` |
| M23 | `withdrawPreviewOf` lists transitive dependants | `landing-line-view`'s direct-only case |
| M24 | the status calls a red line with a fixing head `paused` | `landing-line-view`'s red-fixes-main case |
| M25 | `LANDING_LINE_POLL_MS` is `null` again (no timer) | `use-landing-lines`' 60-second case |
| M26 | the sheet keeps the preview it opened with instead of the current `view` (it resends the old `pinnedAt`) | `landing-withdraw-sheet`'s moved case (the next confirm sends the new `pinnedAt`); the browser moved case |
| M27 | the rows put the other open entries before `order.order` | `landing-line-view`'s running case (exact row order) |
| M28 | the open-entry filter keeps terminal entries | `landing-line-view`'s older-server case |
| M29 | `readLandingLine` accepts an entry whose state is outside `LANDING_ENTRY_STATES` | `landing-line-view`'s guard case |
| M30 | an `ejected` or `unknown` entry listed in `order.order` takes the `in-line` role | `landing-line-view`'s inconsistent-read case |
| M31 | `red-fixes-main` is checked before `held` | `landing-line-view`'s held-with-red case |
| M32 | the hook does not abort its reads on unmount; or `LandingLine` drops its generation ref | `use-landing-lines`' unmount case; `landing-line`'s unmount-before-answer case |
| M33 | the pause control's rejection is shown as nothing (no alert) | `landing-line`'s pause refusal case |
| M34 | `landingNoticeText` writes `#null` when `prOf` answers `null` | `landing-words`' `entry <id>` case |
| M35 | an unreadable raw answer takes the generic unreachable sentence | `landing-line-view`'s unreadable-raw case |
| M36 | the confirm stays enabled under `SHEET_GONE` | `landing-withdraw-sheet`'s terminal case; `landing-line`'s F1 terminal case |
| M37 | an `unknown` row is `withdrawable` (a button that can only be refused) | `landing-line-view`'s running case; `landing-line`'s no-button case; the browser `#109` check |
| M38 | `LandingLine` returns `null` for `none` while its sheet is open (the result lost) | `landing-line`'s only-entry cases; the browser only-entry case |
| M39 | `FleetCards`' hold key leaves out the landing part | `landing-line-hold`'s `~5` case |
| M40 | a door's answer does not call `reload` | `landing-line`'s pause case; `landing-withdraw-sheet`'s answer case |
| M41 | `landingCardOf` draws a line for main red alone (Q2) | `landing-line-view`'s main-red-alone case |
| M42 | `landing-db-commit` is answered with `outcomeUnknown: false` on a write | `landing-words`' `mayApply` case |
| M43 | a line paused and held says only the pause | `landing-line-view`'s paused-and-held case |

## 9. The context rows

`docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md`, C5 Coordination's `pwa/src` cell. Old (once in the file at the baseline):

```text
`fleet/ConflictChip.tsx`, `fleet/conflictWords.ts`, 
```

New, after the six files are added (each task adds its own file's entry). C1's `fleet/**` row would otherwise take them, and `rings/totality` is green either way (m1); the rows keep the files in C5 beside the other coordination console files, so the reviewer reads this block against the pull request:

```text
`fleet/ConflictChip.tsx`, `fleet/conflictWords.ts`, `fleet/landingWords.ts`, `fleet/landingLineView.ts`, `fleet/useLandingLines.ts`, `fleet/LandingLine.tsx`, `fleet/LandingWithdrawSheet.tsx`, `fleet/landing-line.css`, 
```

## 10. Rulings received

**On review run 3895 (round 1, 2026-11-26; call 1388).** Findings are the review's, rulings the coordinator's.

| Item | Ruling | Where the plan carries it |
|---|---|---|
| Q1 | Yes: `LANDING_LINE_POLL_MS = 60_000` replaces the run trigger; `standing` is not exported and `screens/usePrograms.ts` leaves the file list | Decision 1, sections 3 and 4.4, Task 6, rows M19 and M25, README block, D-9108 |
| Q2 | No: with no open entry, only the operator's own pause draws a line | Section 4.2's rule, section 5, "What this does not claim", Task 4, row M41 |
| Q3 | No binding in this wave; "Next to land" in the spec's words (m6) | Section 4.2's words, section 5, "What this does not claim" |
| Q-A | Every known project is read, sized honestly; one reload for every project after a door | Measured facts, section 4.4, section 5, "What this does not claim", README block, D-9108 |
| Q-B | An `unknown` row gets no `Withdraw…` | Section 1, section 4.2 (`withdrawable`), section 4.5, section 5, Task 4, Task 7, row M37 |
| F1 | The sheet outlives the `none` cut | Section 4.5, Tasks 7 and 8, row M38 |
| F2 | No identifier or string `landing`: the prop and local are `landingLine` and `onLandingLineReload` | Measured facts, sections 3 and 4.5, Global Constraints, Task 7 |
| F4 | Each browser case registers its own route; the shared fixture is not extended | Sections 3 and 7, Task 8 |
| F5 | A derived text record for `refusalText`; scope and `mayApply` read from the same word by `Object.hasOwn` | Section 4.2 |
| F7 | The resume sentence made true | Section 5 |
| F8 | The landing block joins the view-hold key | Sections 4.2 and 4.5, Task 7, row M39 |
| F9 | A row per guard listed | Section 8, rows M26 to M36 |
| m1 | The C1 `fleet/**` row stated; the C5 rows keep the files' context and nothing goes red without them | Measured facts, section 9 |
| m2 | The three `mayApply` words carry `outcomeUnknown` | Section 1, section 4.2, Task 3, row M42 |
| m3 | The unchanged-line comparison over what is drawn and sent; the guard keeps no binding | Section 4.2 (`sameLandingState`, `readLandingLine`), Task 6, row M20 |
| m4 | The projection sentence says nothing was changed | Section 4.2's table |
| m5 | Row C7's red and the `world()` call corrected | Task 1 Step 1, row C7 |
| m7 | The focus target named in every case | Sections 4.5 and 5, Tasks 7 and 8 |
| m9 | Paused and held says both | Sections 4.2 and 5, row M43 |
| m10 | Review Focus 2 says what the design does | Review Focus 2, section 4.5 |
| m11 | `SHEET_DEPENDANTS` claims only what the list holds | Section 4.2's sheet words, section 5 |
| One wave | Stays one wave; the seam after Task 5 remains for a short context | Section 2 |

## Deviations found

Six numbers were issued for this plan on 2026-11-26; four are defined below, and the coordinator holds the other two.

- **D-9107 (2026-11-26)** — `landing-door-answers-in-l0`: the two doors' 200 answers, `LandingPauseAnswer` and `LandingWithdrawAnswer`, are declared once in `shared/landingLine.ts`, and the server's `LandingPauseWrite` and `LandingWithdrawWrite` ok arms are expressed over them.
  - Why: the console must name a shared type for each answer and define no copy, and the answers had only server-side types in an L1 file the PWA cannot import.
  - Nothing on the wire changes; the routes still drop `coordinator` from a withdrawal.
- **D-9108 (2026-11-26)** — `landing-line-console-read`: the console reads `GET /api/landing` for every known project's card on the fleet screen, through one `usePoll` at 60 seconds in `FleetCards` (Q1 ruled; revised in fix round 1).
  - N is every known project, since every known project has a card (`groupFleet.ts`, rule R5; about 31 on the fleet box). It reads all N on mount, on each return to the page, every 60 seconds and after each door's answer, in parallel; each read is one synchronous read of the landing tables and about 250 to 600 bytes. A door's answer reloads all N: taps are rare, so there is no second path for one project (Q-A ruled).
  - The last good answer lives in the hook's state; there is no cache. An unchanged line keeps its state object, compared over what the card draws and the sheet sends, never the raw view.
  - A card draws the line only when it has an open entry or the operator's own pause (Q2 ruled).
  - Measured before choosing: no fleet frame field carries the line, and no route lists the projects that have one.
  - Not claimed: a change shows up to a minute late; and if N grows large, the remedy is one server read listing every line, a server wave's, not built here.
- **D-9109 (2026-11-26)** — `landing-line-failure-scope`: a failed read is drawn by its scope. `landing-projection-unreadable`, a project's own damaged row, always shows on its card; every other failure (the journal, the database, the fence, a bad or unreadable answer, an unknown word, an unreachable server) shows only over a line the card already drew, as "not read again"; `not-configured` draws nothing.
  - Why: a box-wide failure would otherwise draw the same alarm on every card, most of which have no line, while hiding it entirely would show a stale line as current.
  - Not claimed: a line paused while every read failed stays unseen until a read succeeds.
- **D-9110 (2026-11-26)** — `landing-subtractive-table-census`: `landing-subtractive.test.ts`'s table list is checked against the database the schema builds (`sqlite_master`'s tables named `landing_*`), so a new landing table that no door may change cannot be left out of the doors' table diff unnoticed (the 5j plan's section 13, C13, carried).
