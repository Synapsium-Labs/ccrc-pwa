# Build 7 — PR J: the coordinator skill, the fleet-host artifacts, and the surfaces that make a program visible

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A program stops being a discipline held in one orchestrator's head. A coordinator session, running a skill that ships to all four account homes, opens a run through the server API, dispatches wave 1, ends its turn, is woken by mail, re-measures the done fingerprint, reviews the handoff commit and dispatches wave 2 — while the operator watches `/runs`, reads `/mail`, and sees this session's outstanding mail above the composer.

**Architecture:** Four artifacts and three screens. On the fleet host: `ccd/coordinator-skill/` (SKILL.md + references) becomes the **fourth** thing ccrc ships to the box, installed into `~/.claude`, `~/.claude-personal`, `~/.claude-corp` and `~/.claude-gpt` by an idempotent installer built to `install-session-hooks.sh`'s exact shape, and `~/.cc-secrets/ccrc-mail.token` becomes the box's credential, shipped only when the operator has minted one and never in git. In the PWA: `/runs` copies `/accounts`'s five-part screen anatomy and is fed by the additive `{type:'runs'}` fleet frame; `/mail` is the first renderer of the durable feed, reading `GET /api/feed` for scrollback and the catch-up tail on receipt; `MailStrip` is `TaskStrip`'s idiom one row higher. Everything server-side is PR I's and is consumed here through the contract in **Interfaces assumed from PR I**.

**Tech Stack:** bash (the skill installer, one `deploy.sh` lane), markdown-as-code (SKILL.md, pinned by a suite), TypeScript ESM (Node ≥22), vitest, React 19. **No new dependencies.** The skill and the installer are tested from `server/test` against fixture HOMEs, the way every other ccd-side artifact in this repo is.

**Spec:** `docs/superpowers/specs/2026-08-07-build7-fleet-coordination-design.md` — **approved for planning and execution**; §5, §6 and the three **Operator rulings (2026-08-08)** are binding.

**Sibling PR:** this is the **second of two**. PR I (`feat/build7-core`, cut from `docs/build7-spec`) ships `coord.db`, the run model, mail ingress + delivery, the coordinator API, the wire types **and the whole box-token lane** (`deploy/notify.sh`, `ship_secret`, `.gitignore`, `deploy/ccrc-mail.token.example`). **This branch is cut from main *after* PR I has merged**, and everything it consumes from PR I is enumerated below rather than assumed. Where the two plans touch one file — `deploy/deploy.sh` — this one adds the skill lane and nothing else.

**Branch:** one PR, `feat/build7-surfaces`, cut from post-PR-I `main`. The orchestrator merges and deploys.

---

## Interfaces assumed from PR I

Every one of these is *consumed* here and *authored* there. If PR I lands a different name or shape, reconcile **here** — this list is the contract, and each entry says the minimum this PR needs. Nothing in this plan needs any part of PR I's internals (`coord.db`'s schema, the sweep lane, the delivery gate); only these.

> **Reconciliation (`feat/build7-core`, whole-branch review — findings 1/9/15/16/27, closed):** this section was written before PR I existed and was never updated against what actually shipped — six of its eleven entries disagreed with the code, and two routes (`POST /api/runs/:id/advance`, `GET /api/mail?to=<id>`) were named as PR I's to author while PR I's own plan pointed back at PR J, so neither side ever built them. Both gaps are closed on `feat/build7-core` now (routes added, box-token gate extended to all six write routes item 6 names). What follows, item by item, is what PR J's implementer will actually find — read this block first, the code samples below it are historical and are NOT what ships:
>
> - **Item 1 (wire types).** Shipped shapes diverge on five points: `RunSummary.id` is `number`, not `string`; there is no `waves` field — `wave`/`waveOf` (a nullable "N of M") plus `programTitle`/`project`/`resumed`/`clearedAt`/`openedAt`/`unreadMail` instead; there is **no `holdReason` field at all** (display-only convention, never written to the wire — `/runs` cannot render it verbatim as this doc says, because it never rides the socket). `RunTally{total,done,failed,blocked}` shipped as `RunItemTally{done,total}` — no `failed`/`blocked` columns exist anywhere (`work_items` has no writer either, see the core plan's own D-60-era finding 5). `MailItem` shipped as `MailSummary`: no `body`, no `rejectCode`, `state: MailDeliveryState` instead of `delivery: MailDelivery`.
> - **Item 2 (`NotifyEvent.runId`).** Not shipped. `NotifyEvent` (`shared/api.ts`) has no `runId` field; a feed row cannot link back to its run without a second lookup.
> - **Item 3 (`{type:'runs'}` frame).** Shipped as specified — `FleetMsg` carries `{ type: 'runs'; runs: RunSummary[] }` (with item 1's `RunSummary` shape, not this doc's).
> - **Item 4 (`{type:'mail'}` session-stream variant).** Not shipped. `SessionStreamMsg` has no `mail` variant; `MailStrip` has no push-side feed and must poll `GET /api/mail?to=<id>` (item 6, below) instead.
> - **Item 5 (`GET /api/runs`).** Shipped, but `includeClosed` defaults to **`false`** — a deliberate cold-start bandwidth choice (`coord/routes.ts`'s own comment) — not "active and finished" by default as stated here. Pass `?closed=1` for the archive view. `GET /api/feed?limit=<n>` matches as specified.
> - **Item 6 (auth + route list).** Now accurate as a POLICY statement — as of this reconciliation, `POST /api/runs`, `POST /api/runs/:id/dispatch`, `POST /api/runs/:id/close`, `POST /api/runs/:id/advance`, `POST /api/mail`, `POST /api/mail/:id/ack` and `GET /api/mail?to=<id>` are ALL gated on `MAIL_TOKEN_HEADER` (findings 3/10/27, closed). Two corrections to the LIST itself: `POST /api/runs/:id/close` is missing from this item's enumeration even though it is real, load-bearing (it runs `ws-release`/`ws-archive`) and now gated the same way — Task 1's route-string suite should pin it too; and the six-route framing undercounts by exactly that one.
> - **Item 7 (`POST /api/runs/:id/advance`).** Now shipped, on `feat/build7-core`. Two shape differences from this doc: the response's refusal is `{ ok: false; reject: { code: string; detail?: string; from?: RunState; to?: RunState } }` — an OBJECT, not the bare string union shown here — and `to` is restricted to exactly `'working' | 'awaiting-review' | 'merging'` (dispatch/close keep the other transitions as their own job; see the route's own docstring in `coord/routes.ts`). Re-measurement only runs when `to` is `'awaiting-review'` or `'merging'`; `to:'working'` never re-measures (mirrors D-49's close-side reasoning: retreating to `working` asserts no doneness claim).
> - **Item 8 (envelope module).** `renderEnvelope` lives at `server/src/coord/envelope.ts` (not `server/src/mail/envelope.ts`) and takes a bespoke `EnvelopeInput` shape, not `(m: MailItem)` — the wire `MailItem`/`MailSummary` divergence in item 1 means the two were never going to be the same type. Task 1's byte-identical assertion should import from the real path.
> - **Items 9/10/11.** Unaffected by this reconciliation — push/record semantics, the box-token lane, and the README repeal all match what PR I actually shipped.



**1. Wire types in `shared/api.ts`.**

```ts
/** 'unknown' is the designated we-do-not-know member (spec §2). The server
 *  NEVER emits it; it is where a state from a newer build lands in an older
 *  client. */
export type RunState =
  | 'planned' | 'dispatched' | 'working' | 'awaiting-review'
  | 'merging' | 'closing' | 'done' | 'failed' | 'unknown';

export interface RunTally { total: number; done: number; failed: number; blocked: number }

export interface RunSummary {
  id: string;
  program: string;                 // the slug; joins the markdown ledger
  wave: number;
  waves: number | null;            // N of `wave:N/M`; null when the program never declared M
  sessionId: string | null;        // null before dispatch, and after the session is gone
  workspace: string | null;
  branch: string | null;
  state: RunState;
  dispatchedAt: number | null;     // epoch ms
  closedAt: number | null;         // epoch ms; non-null IS "finished"
  holdReason: string | null;       // verbatim, display-only, NEVER parsed (registry.ts:27)
  items: RunTally;
}

export type MailKind = 'finding' | 'question' | 'answer' | 'status' | 'artifact' | 'unknown';
export type MailDelivery = 'queued' | 'delivered' | 'acked' | 'rejected' | 'unknown';

export interface MailItem {
  id: string; at: number;
  fromId: string; toId: string;    // toId is 'coordinator' or a session id
  runId: string | null;
  kind: MailKind;
  subject: string; body: string;
  artifacts: string[];             // PATHS, not payloads (spec §1)
  delivery: MailDelivery;
  rejectCode: string | null;
}
```

**2. `NotifyEvent` widened, additively** (`shared/api.ts:1310-1314` today):

```ts
export interface NotifyEvent {
  seq: number; at: number;
  kind: 'ask' | 'done' | 'merged' | 'mail' | 'run' | 'unknown';
  sessionId: string; title: string; body: string;
  runId: string | null;            // NEW, nullable — an older build lacked it
}
```

**3. `FleetMsg` gains one additive variant** (old clients already drop unknown frame types — `stores/fleet.ts:139`):

```ts
| { type: 'runs'; runs: RunSummary[] }
```

**4. `SessionStreamMsg` gains one additive variant**, carrying **outstanding** mail for that session only (`delivery ∈ {queued, delivered}` — acked and rejected are excluded server-side):

```ts
| { type: 'mail'; mail: MailItem[] }
```

**5. Two REST reads.** `GET /api/runs` → `{ runs: RunSummary[] }`, active **and** finished (the client splits on `closedAt`). `GET /api/feed?limit=<n>` → `{ events: NotifyEvent[] }`, oldest-first, read from `coord.db` so it **survives a deploy** — this is the durable half that today's 200-event in-memory ring is not.

**6. Coordinator write routes**, all authenticated by the box token in the **`x-ccrc-mail-token`** header (`MAIL_TOKEN_HEADER`, PR I's `server/src/coord/token.ts` — *not* `Authorization: Bearer`), all recording on the run: `POST /api/runs`, `POST /api/runs/:id/dispatch`, `POST /api/runs/:id/advance`, `POST /api/mail`, `POST /api/mail/:id/ack`, `GET /api/mail?to=<id>`. Route paths are consumed **as literal strings by a test in Task 1** (fastify spells params `:id`, so the SKILL.md text and the route registration match character for character). **Reconciled 2026-08-08:** the dispatch route for wave ≥ 2 performs `ensure` → an injected `/clear` (send-path proof discipline) → brief-as-mail itself, recording `resumed`/`clearedAt` on the run — the SKILL must call dispatch and *never* inject `/clear` on its own (one writer per step; the route is the chokepoint).

**7. `POST /api/runs/:id/advance`** takes `{ to: RunState; fingerprint: { branchTip, prNumber, prPhase, handoffCommit } }` and answers either `{ ok: true; run: RunSummary }` or `{ ok: false; reject: 'stale-tip' | 'pr-regressed' | 'no-handoff-commit' | 'unknown-run' | 'paused' | 'capped' | … }`. **The server re-measures and its answer is authoritative** (see D-6).

**8. `server/src/mail/envelope.ts` exports `renderEnvelope(m: MailItem): string`** — the exact text the delivery lane injects. Task 1's suite asserts the SKILL.md's worked example is **byte-identical** to what this function returns for a fixture, so the prose and the injector cannot drift.

**9. Push and recording semantics** (spec §6): mail/run events are recorded in the feed **regardless of presence** — only their *push* is presence-gated — and their tags do **not** collapse per session (`mail-<mailId>`, `run-<runId>-<state>`), so two messages about one session never replace each other.

**10. The box token lane is PR I's, end to end.** One local `deploy/ccrc-mail.token` (gitignored; `deploy/ccrc-mail.token.example` says how to mint it) is shipped by PR I's `ship_secret` to **both** boxes — `~/.cc-secrets/ccrc-mail.token` on the fleet host (what `notify.sh` and every session present) and `~/.ccrc/mail.token` on the server box (read at boot; **not** an env var, because PR I's D-note refuses to touch `ccrc.service`). PR I also rewrites `deploy/notify.sh` and adds the `.gitignore` entry. **This PR edits none of those**; it depends on them, verifies they exist, and adds only the skill's own lane to `deploy.sh`'s agent arm.

**11. README's "No database" repeal.** If PR I has already rewritten `README.md:20`, Task 7 verifies and moves on; if not, Task 7 does it. Task 7 owns the `local`-vs-`remote` fleet-mode correction (`README.md:443-445`) either way.

---

## Deviations found

Eight, recorded rather than silently redesigned. Each names the minimal faithful adaptation.

### D-1 (blocking) — `isUnseen` cannot count a feed, and `prune` would delete the feed's ack

Spec §6: *"Unread counting via `isUnseen`/`ack` (the pre-committed single implementation)"*. Measured: `isUnseen(s: FleetSession, acks)` (`pwa/src/lib/seen.ts:151-155`) is gated on `BADGED.has(s.bucket)` and compares `s.bucketSince` — a `NotifyEvent` has no bucket and no `bucketSince`, so the function **cannot be called** on one. Worse, `prune(live)` (`seen.ts:214-226`) deletes every key in the ack map that is not a live **session id**, and it runs on every fleet snapshot (`FleetScreen.tsx`'s effect) — so a feed watermark stored in that map would be deleted within ~2 s of being written, silently re-badging the whole feed unread **and persisting the deletion**.

**Adaptation:** extract the comparison itself, one level down:

```ts
export function isUnseenAt(key: string, since: number | null, acks: Acks): boolean {
  if (since === null) return false;
  return since > (acks[key] ?? 0);
}
```

`isUnseen` becomes its only session-side caller, so there is still **exactly one comparison** in the tree — which is what `groupFleet.ts:30-44`'s pre-commitment actually asks for (*"it counts with `isUnseen` like this does, rather than re-implementing the comparison"*). And `prune` gains one namespace rule: **a key containing `:` is not a session id and is never pruned.** ccd's own id regex is `^[A-Za-z0-9._-]+$` (`ccd/ccd:1671`, `:4739`), so `:` cannot appear in a session id — the namespace is collision-proof by a rule ccd already enforces. The feed's key is the constant `FEED_ACK_KEY = 'ccrc:feed'`.

### D-2 (blocking) — "badged on the bell" would make one control mean two things, and leave `/mail` with no door

`NotificationBell` (`pwa/src/fleet/NotificationBell.tsx:53-64`) is an `aria-pressed` **toggle** for Web Push. Painting an unread count on it produces a control whose glyph reports one fact and whose action does something unrelated — against DIRECTION.md's *"no state the user has to interpret"* (`:226-228`) — and leaves the feed screen unreachable. `/accounts` already paid for this lesson in writing: the only door to a screen *must never render nothing* (`AccountsStrip.tsx:9-15`, `:90-93`).

**Adaptation:** the badge is a **sibling** control **at** the bell, not a count on it. `MailBadge` mounts in `.fleet-head-right` immediately before `<NotificationBell />`, is **always** rendered (it is the only door to `/mail`), carries the count when there is one, and navigates. Nothing nests inside anything — the standing rule from commit `ce313de` (*"no control nests in another"*). The bell keeps its exact current shape and copy.

### D-3 (blocking) — the durable feed cannot be the catch-up ring

Spec §6 calls the mail feed *"the first renderer of the durable feed"*. Measured: `FleetState.missed` is filled once per socket open and the watermark **advances one-way at receipt** (`pwa/src/lib/notifymark.ts:56-65`), and the server's ring is 200 events **in memory** with only `{epoch, seq}` persisted (`server/src/notifylog.ts:6,24,87`). ccrc deploys several times a day. A feed built only on catch-up shows an empty inbox after every deploy — truthfully and uselessly.

**Adaptation:** the screen reads `GET /api/feed?limit=100` (durable, `coord.db`, PR I) on mount **and** merges the live catch-up tail by `seq`. The store slice is renamed `missed` → `feed` and is rendered **on receipt**, which is precisely what `notifymark.ts`'s docstring demands of whoever renders it first (*"must not call it missed, and must render it on receipt"*). `clearMissed()` → `clearFeed()`; `pwa/test/presence-catchup.test.ts` (`:161`, `:187`, `:206`, `:242`, `:245-255`) is updated with it.

### D-4 (stated) — the reconstruction drill's parser is test-only, on purpose

Spec §2 requires *"a test [that] proves the reconstruction path for a representative program"*; spec §7 says the ledger *"is for humans and parsed by nothing"*. Both hold only if the drill's parser never ships. **Adaptation:** the entire reconstruction lives in `server/test/reconstruction-drill.test.ts`, and Task 7 adds a structural guard asserting **no file under `server/src` mentions `docs/superpowers/programs`** — the mechanism, not a comment asking nicely. The drill also asserts, explicitly, the exact set of fields it **cannot** recover, so it can never be read as a claim of completeness.

### D-5 (naming) — `tasks` is taken, and so is `.task-strip`

`TaskItem`/`TaskProgress`/`tasks` are Claude Code's TodoWrite plan items across `shared/`, `server/` and `pwa/` (`shared/api.ts:82-105`, `SessionStreamMsg`'s `{type:'tasks'}`), and `server/test/single-definition.test.ts` text-scans all four source roots for exactly this class of second copy. The session mail strip therefore copies `TaskStrip`'s **idiom** and none of its names: component `MailStrip`, class `.mail-strip`, frame `{type:'mail'}`, item `MailItem`. No file in this PR defines a second `TaskItem`-shaped thing.

### D-6 (accepted, stated) — the done fingerprint is re-measured twice, and only the second one counts

Spec §3 says *"The coordinator **re-measures** each fact … before advancing the run"*; spec §5 says the server is the single recorded chokepoint that makes caps *enforced* and every act *recorded*. Both are kept, with the authority named: the skill re-measures as a **pre-flight** (so it can decide whether to advance at all without burning a rejected call), and `POST /api/runs/:id/advance` re-measures **again server-side and its answer is authoritative** (PR I). A coordinator that has gone stale therefore cannot settle a run by asserting it did the measurement — which is the whole point of Orca's rule. The skill's contract says this in one sentence and Task 1 pins that sentence.

### D-7 (duplication, pinned rather than removed) — the ledger template ships twice

The skill installs into four **account homes** on the fleet host and is used against **any** project, most of which have no `docs/superpowers/programs/TEMPLATE.md`. So the skill must carry the template. That is a second copy of a file this repo already has, and the repo's answer to a copy it cannot eliminate is a test: `server/test/coordinator-skill.test.ts` asserts `ccd/coordinator-skill/references/ledger-template.md` is **byte-identical** to `docs/superpowers/programs/TEMPLATE.md`. Editing one without the other is a red suite, not a drift.

### D-8 (scope, corrected against the sibling plan) — the whole token lane is PR I's, including `notify.sh`

The brief for this PR named *"the box token `~/.cc-secrets/ccrc-mail.token` shipping/creation story"* as PR J's. Read against the sibling plan as written, that is a **double edit**: `feat/build7-core` already rewrites `deploy/notify.sh` whole, adds `ship_secret` to `deploy.sh` (shipping one local file to **both** boxes), adds the `.gitignore` line and creates `deploy/ccrc-mail.token.example`. Two plans editing one file is the failure mode a sibling-plan reconciliation exists to catch.

**Adaptation:** this PR ships **no** token machinery. Task 2 keeps only what is genuinely its own — the skill directory and its installer in `deploy.sh`'s agent arm — and adds *verification* that PR I's lane is present (an existence-and-shape assertion over `deploy.sh` and `.gitignore`, never a second implementation, and never reading a token). It also inherits PR I's header name: the credential travels as **`x-ccrc-mail-token`**, not as `Authorization: Bearer`, and the skill's contract clause says so verbatim because the test pins that sentence.

---

## Global Constraints (from the spec, verbatim where quoted)

- **The coordinator acts through the API, never raw ccd.** *"It acts through the server's HTTP API, not raw ccd. … Raw ccd remains physically possible (fact 2); the skill's contract plus the single recorded chokepoint is the honest boundary."* The skill's contract is therefore **prose that must be exact**, and it is treated as code: pinned sentence by sentence.
- **`ws-reap` stays human-only, by convention plus a speed bump, named as exactly that.** *"the coordinator's skill contract excludes reap; the coordinator holds every workspace it owns … and reap consent stays in the PWA ceremony."* Nothing in this PR pretends a mechanism exists.
- **Pause is a file.** `$REG/coordinator-paused`, operator-owned (`touch`/`rm`). *"no verb, no route, no way for the coordinator to unpause itself."*
- **The brief's content stays discipline.** *"the skill carries the template, the quality gate stays ordinary review of the handoff commit."*
- **The wave lifecycle is Build 2.5's six steps, automated** — open the run (ledger commit + hold), dispatch, watch mail + pr-state, re-measure the done fingerprint, review the handoff commit, update the hold reason, dispatch wave N+1 fresh into the same workspace, release on final merge.
- **The install lane is four homes.** Operator ruling 2: *"The coordinator is placed like any session — `_ws_least_loaded`, no pinned account. (The four-homes skill install lane is what makes this safe: a swap can never strand it on an account without the skill.)"*
- **Secrets are never in git.** Only `*.example` templates are committed (`.gitignore`, `deploy/deploy.sh:28-29`). Tests may assert a secret file's **existence and mode**, never its content, and never against the live `$HOME`.
- **`/runs` and `/mail`**: *"route free; `/fleet` and `/docs` are co-tenant reserved"* — the SPA fallback deny-lists both (`pwa/vite.config.ts:57`).
- **Run rows:** *"Rows are mono machine voice; **no glow — runs are not living panes**; status vocabulary gets its own small table, not `SessionBucket`'s."*
- **The feed:** *"a client-side unknown-kind degradation branch (today's closed 3-union has none), tags that do **not** collapse per session (two messages must not replace each other), and a **presence-gate exemption**: agent-to-agent mail is a record, not a 'needs your eyes' ping — it lands in the feed regardless of watching, and only its *push* is presence-gated."*
- **The strip:** *"outstanding mail for *this* session, collapsed to a headline, nothing when empty. (A full in-transcript mail `ChatItem` is deferred to Build 4's transcript surface — one build owns the conversation model.)"* **No `ChatItem` arm, no `ChatList` change, in this PR.**
- **Design gates, both halves.** Tap targets: scrape the rule off the stylesheet **and** render the component to prove the class is on a real element (`pwa/test/tap-targets.test.tsx:13-17`); vitest runs with `css: false`, so no test may assert a computed 44px, and every floored rule uses `var(--tap-min)` — a bare `44px` literal fails (`:193-206`). Contrast: `pwa/design/audit.mjs` walks **every** `.css` under `src/` automatically (`:129-143`), so new rules are measured the moment they exist; the cheapest path is what the bucket chips took — **self-grounded** rules (background + colour on one rule, `fleet.css:66-80`) so nothing is hand-registered.
- **Rollout: agent first**, then server, then PWA — *"agent-first is trivially satisfied (no ccd changes; the skill + token ship via the install lane)"*.
- Run ALL verification **FOREGROUND** in single blocking calls (the server suite is ~200 s; the ccd files alone are ~90 s — use `timeout ≥ 600000` ms). Report REAL printed counts. **Never background a suite.**
- **Never run `ccd` against the live HOME. Never touch tmux, `~/.cc-sessions`, `~/.cc-limits`, or `~/.cc-secrets` outside a fixture HOME.** Every shell test below builds its own HOME with `mkTmp`.
- **Mutation sweep the whole diff** — one literal mutant per added construct, full suite per mutant, sha256-verified restore between (Task 8).

**Read the code before you write it.** Every code block below is **shape-authoritative, not text-authoritative**: it fixes the decision, the comment and the assertion, but where it disagrees with a harness helper, an existing idiom or a neighbouring file's conventions, **the tree wins**. `server/test/tmpHelpers.ts` is the authority on `mkTmp`; `server/test/install-session-hooks.test.ts` is the authority on how a shell installer is tested here; `pwa/test/tap-targets.test.tsx:50-57` is the authority on the current `FleetSession` fixture shape; `pwa/test/cssRule.ts` is the authority on `ruleIn`/`declValue`/`norm`/`stripComments`. Copy from them rather than from here when the two differ.

---

## File Structure

| file | responsibility | change |
|---|---|---|
| `ccd/coordinator-skill/SKILL.md` | **new** — the coordinator's contract and the wave lifecycle | create |
| `ccd/coordinator-skill/references/wave-lifecycle.md` | **new** — the six steps, expanded, with the exact calls | create |
| `ccd/coordinator-skill/references/mail-envelope.md` | **new** — the envelope read/written, and the ack rule | create |
| `ccd/coordinator-skill/references/ledger-template.md` | **new** — byte-identical copy of `docs/superpowers/programs/TEMPLATE.md` (**D-7**) | create |
| `server/test/coordinator-skill.test.ts` | **new** — the skill's suite: contract clauses, route linkage, envelope equality, template equality | create |
| `ccd/install-coordinator-skill.sh` | **new** — four homes, idempotent, backed up, refuses rather than degrades | create |
| `server/test/install-coordinator-skill.test.ts` | **new** — installer behaviour against fixture HOMEs | create |
| `deploy/deploy.sh` | agent arm (`:39-82`), after `:66` | skill rsync + installer run, and nothing else (**D-8**) |
| `pwa/src/lib/seen.ts` | the one unseen comparison (`:151-155`), `prune` (`:214-226`) | `+isUnseenAt`, `+FEED_ACK_KEY`, namespace rule (**D-1**) |
| `pwa/test/seen.test.ts` | its suite | +6 cases |
| `pwa/src/lib/feed.ts` | **new** — `reviveNotifyEvents`, merge-by-seq, unknown-kind degradation | create |
| `pwa/test/feed.test.ts` | **new** | create |
| `pwa/src/lib/api.ts` | the client (`:186-260`) | `+runs()`, `+feed(limit)` |
| `pwa/src/stores/fleet.ts` | `missed` (`:27-47`, `:130`), `asFleetMsg` (`:54-74`), `onMessage` (`:137-159`) | `missed`→`feed`, `+runs`, `+mergeFeed`, `+ackFeed`; `runs` frame arm |
| `pwa/test/presence-catchup.test.ts` | `missed` assertions (`:161`, `:187`, `:206`, `:242`, `:245-255`) | renamed |
| `pwa/test/stores.test.ts` | store shape | +2 cases (`runs` frame, unknown frame still dropped) |
| `pwa/src/fleet/MailBadge.tsx` | **new** — the door to `/mail`, always mounted (**D-2**) | create |
| `pwa/src/screens/MailScreen.tsx` | **new** — the feed | create |
| `pwa/src/screens/RunsScreen.tsx` | **new** — the run board | create |
| `pwa/src/fleet/runWords.ts` | **new** — the run status vocabulary, its own small table | create |
| `pwa/src/session/MailStrip.tsx` | **new** — outstanding mail for this session | create |
| `pwa/src/stores/session.ts` | `SessionSnapshot`, `applySessionMsg` (`:116-177`) | `+mail` slot, `+case 'mail'` |
| `pwa/src/screens/SessionScreen.tsx` | above the composer (`:262-264`) | `+<MailStrip />` above `<TaskStrip />` |
| `pwa/src/screens/FleetScreen.tsx` | head (`:204-210`), footer (`:371-393`) | `+<MailBadge />`, `+.fleet-runs-row` |
| `pwa/src/app.tsx` | routes (`:41-44`), `data-view` OR (`:52`), detail slot (`:64-81`) | `+/runs`, `+/mail` |
| `pwa/src/fleet/fleet.css` | one stylesheet, auto-audited | + run board, feed, badge, footer-row rules |
| `pwa/src/session/chat.css` | the session sheet | + `.mail-strip` rules |
| `pwa/test/app.test.tsx` | route + `data-view` | +2 cases |
| `pwa/test/runs-screen.test.tsx` | **new** | create |
| `pwa/test/mail-screen.test.tsx` | **new** | create |
| `pwa/test/mail-strip.test.tsx` | **new** | create |
| `pwa/test/tap-targets.test.tsx` | the 44px floor | +4 rules, +4 render proofs, + the literal ban list |
| `pwa/test/fleet-css.test.ts` | stylesheet facts | + the no-glow assertions |
| `server/test/reconstruction-drill.test.ts` | **new** — the §2 drill | create |
| `server/test/fixtures/reconstruct/**` | **new** — ledger + registry + prhistory | create |
| `server/test/single-definition.test.ts` | structural guards | +1 guard (no `server/src` reads the ledger — **D-4**) |
| `README.md` | operator-facing | fleet coordination section; the mode correction; dogfood note |

---

### Task 1: the coordinator's contract, written as code

**Files:**
- Create: `ccd/coordinator-skill/SKILL.md`
- Create: `ccd/coordinator-skill/references/wave-lifecycle.md`
- Create: `ccd/coordinator-skill/references/mail-envelope.md`
- Create: `ccd/coordinator-skill/references/ledger-template.md`
- Create: `server/test/coordinator-skill.test.ts`

**Interfaces:**
- Consumes: `renderEnvelope` (`server/src/mail/envelope.ts`, PR I — interface 8); the route literals of interface 6; `docs/superpowers/programs/TEMPLATE.md`; `ccd/session-hook.sh:15-19`'s self-identification three-liner.
- Produces: a skill directory the install lane (Task 2) copies verbatim, and four test-enforced properties of its prose.

**This is prose engineering, and the suite is what makes it engineering.** A skill is instructions a model follows unsupervised against a fleet it can destroy; a vague clause is a defect with the same blast radius as a missing guard. Four properties are therefore mechanical rather than reviewed-once:

1. **Eight contract clauses exist verbatim.** Deleting or softening one goes red.
2. **Every route the skill names exists in the server.** The linkage test `wsaudit.test.ts` runs for refusal tokens, run over route strings.
3. **The worked envelope is byte-identical to `renderEnvelope`'s output.** Prose and injector cannot drift.
4. **The shipped ledger template is byte-identical to the repo's** (**D-7**).

**What the skill does NOT contain, deliberately:** any `ccd` invocation that changes fleet state, any instruction to poll in a loop, any wording that would let a reap read as sanctioned, and any copy of the wave brief's *content* (the template is the shape; the content is the session's judgement — spec §5).

- [ ] **Step 1: Write the failing suite**

Create `server/test/coordinator-skill.test.ts`:

```ts
// The coordinator skill is prose a model follows unsupervised against a fleet
// it can destroy. These are the properties a review cannot hold in place:
// eight contract clauses, the routes it names, the envelope it quotes and the
// template it ships. `wsaudit.test.ts` already established the idiom — harvest
// tokens out of a source and require the copy to match it in both directions.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderEnvelope } from '../src/mail/envelope.js';
import type { MailItem } from '../../shared/api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const skillDir = path.join(root, 'ccd/coordinator-skill');
const skill = readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const refs = (name: string): string =>
  readFileSync(path.join(skillDir, 'references', name), 'utf8');
const allSkillText = [skill, refs('wave-lifecycle.md'), refs('mail-envelope.md')].join('\n');

/** Every .ts under server/src, read once — the linkage test's corpus. */
const serverSources = (): string => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(path.join(root, 'server/src'));
  return out.join('\n');
};

// The eight clauses, verbatim. Kept as a literal array rather than a regex per
// clause: the point is that the SENTENCE is the contract, so a paraphrase must
// fail exactly as a deletion does.
const CONTRACT = [
  'Every act that changes fleet state goes through the ccrc server HTTP API. This session never runs `ccd` to change fleet state.',
  'The box token is read from `~/.cc-secrets/ccrc-mail.token` and sent as the `x-ccrc-mail-token` header. It is never printed, never pasted into a prompt, never committed.',
  'This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason.',
  'This session never unpauses itself. `$REG/coordinator-paused` is the operator’s file; a dispatch refused `paused` is a stop, and the next act is a report, not a retry.',
  'A wave brief is written prose, reviewed like code. The template is the shape; the content is this session’s judgement, and a brief that is missing something the next wave needs is a defect in the ledger.',
  'A `wave-done` is a claim, not a fact. Re-measure it, then submit the fingerprint to `POST /api/runs/:id/advance` and believe the server’s answer over your own.',
  'This session does not poll in a loop. After a dispatch it ends its turn; mail wakes it.',
  'One coordinator per program. If `POST /api/runs` answers `claimed`, stop — another coordinator owns this program.',
];

describe('the coordinator skill: its contract', () => {
  it('carries all eight clauses verbatim', () => {
    for (const clause of CONTRACT) {
      expect(skill, `missing contract clause: ${clause.slice(0, 48)}…`).toContain(clause);
    }
  });

  it('names the three destructive verbs ONLY inside the clause that forbids them', () => {
    // A skill that mentions `ws-reap` anywhere else has given a model a reason
    // to consider it. The forbidding clause is the one licensed mention.
    for (const verb of ['ws-reap', 'ws-rm', 'ws-gc']) {
      const hits = allSkillText.split(verb).length - 1;
      const licensed = CONTRACT[2]!.split(verb).length - 1;
      expect(hits, `${verb} appears ${hits}×; only the forbidding clause may name it`).toBe(licensed);
    }
  });

  it('tells the session how to learn its own id the ONE way that works on this box', () => {
    // ccd/session-hook.sh:15-19 — derived from tmux, never from a `from:`
    // field. Copied because the skill runs where the hook runs.
    expect(skill).toContain("tmux display-message -p '#S'");
    expect(skill).toContain('cc-');
  });

  it('has YAML frontmatter with a name and a description that says when NOT to use it', () => {
    expect(skill.startsWith('---\n')).toBe(true);
    const fm = skill.slice(4, skill.indexOf('\n---', 4));
    expect(fm).toContain('name: ccrc-coordinator');
    expect(fm).toMatch(/description:.+/);
    expect(fm.toLowerCase()).toContain('never use it to do a wave');
  });
});

describe('the coordinator skill: linkage', () => {
  it('names no route the server does not register', () => {
    // fastify spells params `:id` and so does the skill, so the match is
    // character for character — the same trick that makes wsaudit's harvest a
    // two-line assertion instead of an allowlist.
    const routes = new Set<string>();
    for (const m of allSkillText.matchAll(/\b(?:GET|POST) (\/api\/[A-Za-z0-9/:._-]+)/g)) {
      routes.add(m[1]!.replace(/[.,)]+$/, ''));
    }
    expect(routes.size, 'the skill should name the routes it calls').toBeGreaterThanOrEqual(6);
    const src = serverSources();
    for (const r of routes) expect(src, `no server route registers ${r}`).toContain(`'${r}'`);
  });

  it('quotes an envelope byte-identical to what the delivery lane injects', () => {
    const fixture: MailItem = {
      id: 'm-0007', at: 1_754_600_000_000,
      fromId: 'ccrc-pwa-clear-cove', toId: 'coordinator', runId: 'run-3',
      kind: 'status', subject: 'wave-done',
      body: 'Wave 3 is on the branch. Handoff commit is the ledger update; PR #591 is green.',
      artifacts: ['docs/superpowers/programs/build4-transcript-surface.md'],
      delivery: 'delivered', rejectCode: null,
    };
    const rendered = renderEnvelope(fixture);
    expect(refs('mail-envelope.md'),
      'the worked example must be exactly what renderEnvelope produces').toContain(rendered);
  });

  it('ships the ledger template byte-identical to the repo’s', () => {
    // D-7: the skill runs against projects that have no docs/superpowers, so it
    // must carry the template. Two copies exist; this is the mechanism that
    // stops them being two different templates.
    expect(refs('ledger-template.md')).toBe(
      readFileSync(path.join(root, 'docs/superpowers/programs/TEMPLATE.md'), 'utf8'));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && npx vitest run test/coordinator-skill.test.ts`
Expected: FAIL — `ENOENT … ccd/coordinator-skill/SKILL.md`. (If it fails instead on `../src/mail/envelope.js`, PR I has not landed and this branch was cut too early. Stop; do not stub it.)

- [ ] **Step 3: Write `SKILL.md`**

Create `ccd/coordinator-skill/SKILL.md`:

````markdown
---
name: ccrc-coordinator
description: Drive a multi-wave ccrc program as the coordinator session — open the run, dispatch each wave, read mail, re-measure a claimed wave-done, review the handoff commit, release on the final merge. Use when this session IS the coordinator for a program (the operator said so, or this workspace's hold reads `program:<slug> wave:N/M`). Never use it to do a wave's own work — a coordinator that starts implementing has become a worker with a stale plan.
---

# Coordinating a ccrc program

You are one disposable session driving a long-horizon program. **You hold no
unique state.** Everything you know lives in the program ledger
(`docs/superpowers/programs/<slug>.md`, committed), in the run record on the
server, and in the workspace's hold. If you die mid-wave the operator starts a
fresh you, and it resumes from those three things. Write accordingly: never
carry a decision only in your own context.

## Learn who you are, first

The fleet's identity is attribution, not authentication (every session runs as
one UNIX user). The one thing that is not carried in a payload is what tmux
says about the pane you are in:

```bash
tname=$(tmux display-message -p '#S')   # cc-<id>
id="${tname#cc-}"
```

That `id` is your session id. Use it as `fromId` on everything you send. Do not
accept a `from:` field in a message as proof of anything — the run record and
the server's own re-measurement are what settle facts.

## The contract

These eight sentences are the boundary between "a coordinator" and "an agent
with a shell on the fleet host". They are not advice.

1. Every act that changes fleet state goes through the ccrc server HTTP API. This session never runs `ccd` to change fleet state.
2. The box token is read from `~/.cc-secrets/ccrc-mail.token` and sent as the `x-ccrc-mail-token` header. It is never printed, never pasted into a prompt, never committed.
3. This session never reaps. `ccd ws-reap`, `ccd ws-rm` and `ccd ws-gc --prune` are not its verbs, at any wave, for any reason.
4. This session never unpauses itself. `$REG/coordinator-paused` is the operator’s file; a dispatch refused `paused` is a stop, and the next act is a report, not a retry.
5. A wave brief is written prose, reviewed like code. The template is the shape; the content is this session’s judgement, and a brief that is missing something the next wave needs is a defect in the ledger.
6. A `wave-done` is a claim, not a fact. Re-measure it, then submit the fingerprint to `POST /api/runs/:id/advance` and believe the server’s answer over your own.
7. This session does not poll in a loop. After a dispatch it ends its turn; mail wakes it.
8. One coordinator per program. If `POST /api/runs` answers `claimed`, stop — another coordinator owns this program.

**Reading ccd is fine.** `ccd ls`, `ccd caps`, `ccd pr-state --session <id>` and
`ccd ws-audit --session <id>` are read-only and answer faster than a round trip.
Clause 1 is about *changing* fleet state, and the reason is not that ccd is
unsafe — it is that an act the server did not record did not happen as far as
the run board, the caps and the operator are concerned.

## How to call the API

```bash
TOKEN=$(cat ~/.cc-secrets/ccrc-mail.token)
curl -fsS -X POST "http://203.0.113.7:7788/api/runs" \
  -H "x-ccrc-mail-token: $TOKEN" -H 'content-type: application/json' \
  -d '{"program":"<slug>","title":"<title>","waves":4}'
```

Never echo `$TOKEN`. Never put it in a commit, a ledger, a mail body or a
report. If a command would print it, redirect the command instead of printing
the token.

Every write route answers JSON. A refusal is an **answer**, not an error: read
`reject` and act on it. The refusals you will actually meet are
`paused`, `capped`, `claimed`, `stale-tip`, `pr-regressed`, `no-handoff-commit`,
`unknown-run`. Their meanings are in `references/wave-lifecycle.md`.

## The wave lifecycle

Six steps, and they are Build 2.5's manual six with the manual taken out. The
full form — every call, every refusal, what to do with each — is
`references/wave-lifecycle.md`. Read it before the first dispatch of a program,
not after.

1. **Open the run.** Write the ledger from `references/ledger-template.md`,
   commit it, then `POST /api/runs`. The server places the hold whose reason is
   `program:<slug> wave:1/M`.
2. **Dispatch.** `POST /api/runs/:id/dispatch` with the wave brief. Then **end
   your turn** (clause 7).
3. **Wake on mail.** A worker's message arrives injected in the envelope shape
   in `references/mail-envelope.md`. Ack it (`POST /api/mail/:id/ack`) before
   acting on it, or the delivery lane replays it verbatim.
4. **Re-measure a claimed `wave-done`**, then `POST /api/runs/:id/advance` with
   the fingerprint. A typed rejection means the claim was stale: mail the worker
   the rejection code and leave the run where it is.
5. **Review the handoff commit** like any other commit, update the ledger, and
   update the hold reason to `wave:N+1/M` via
   `POST /api/sessions/:id/hold`. Then dispatch wave N+1 **fresh into the same
   workspace**.
6. **Final merge:** release the hold (`POST /api/sessions/:id/release`) and let
   the ordinary sweep archive the workspace. Do not archive it yourself unless
   the operator asks.

## What stays discipline

Handoffs are commits. Briefs are prose reviewed like code. The ledger is for
humans and is parsed by nothing — including you: read it, do not build a parser
for it. Parallelism only across workspaces a plan proves disjoint. SDD's per-PR
mechanics (implement → review lenses → whole-branch pass) are unchanged; you
*dispatch* that shape, you do not reinvent it.

## When something is wrong

- **A dispatch is refused `paused`.** Stop. Report to the operator. Do not
  touch the file.
- **A dispatch is refused `capped`.** Stop, say which cap, and wait to be woken.
- **A worker has gone dead mid-wave.** The run says so. Re-dispatch fresh into
  the held workspace — that is the recovery the hold exists for.
- **Your own run row disagrees with the ledger.** The run row is the machine's
  record and the ledger is the human's; if they disagree, the ledger is what a
  reviewer will read, so fix the ledger in a commit and say so in the report.
- **You cannot reach the server.** Nothing is invented and nothing is done by
  hand: stop and report. A program that stalls honestly is recoverable.
````

- [ ] **Step 4: Write the two references**

Create `ccd/coordinator-skill/references/wave-lifecycle.md` — the six steps with
every call spelled out, the refusal table, and the two rules that are easy to
get wrong (ack before acting; end the turn after dispatch):

```markdown
# The wave lifecycle, in full

Every call below is `POST`/`GET` against `http://203.0.113.7:7788` with
`x-ccrc-mail-token: $(cat ~/.cc-secrets/ccrc-mail.token)`.

## 1 — Open the run

1. Copy `references/ledger-template.md` to
   `docs/superpowers/programs/<slug>.md` in the project's own repo, fill the
   header and the wave-1 row, and **commit it**. The commit is the artefact; an
   uncommitted ledger is not a handoff.
2. `POST /api/runs` `{"program":"<slug>","title":"<title>","waves":<M>}`
   → `{"run":{…}}`, or `{"reject":"claimed"}` if another coordinator holds this
   program (clause 8 — stop).

The server places the hold. Its reason is `program:<slug> wave:1/M`, and it is
**display-only** — never parse a hold reason to learn what wave you are on. Ask
`GET /api/runs` and read the run row's own `wave`.

## 2 — Dispatch a wave

`POST /api/runs/:id/dispatch` `{"brief":"<the wave brief, prose>"}`
→ `{"run":{…}}` with `state: "dispatched"`, or a refusal:

| reject | what it means | what you do |
|---|---|---|
| `paused` | `$REG/coordinator-paused` exists | stop, report, touch nothing |
| `capped` | `maxConcurrentWorkers` or `maxSessionsPerDay` | stop, name the cap, wait |
| `unknown-run` | the run id is wrong or the DB was rebuilt | re-read `GET /api/runs` |
| `fleet-unreachable` | the fleet host is not answering | stop and report; invent nothing |

Then **end your turn.** Do not sleep-poll. Do not "check in five minutes". The
delivery lane will inject the worker's mail into your session when it is idle,
and that injection is your next turn.

## 3 — Read mail

Mail arrives as the envelope in `references/mail-envelope.md`. For each one:

1. `POST /api/mail/:id/ack` **first**. Until you ack, the lane replays it
   verbatim on later sweeps — you will see it again, and a second copy of a
   message you already acted on is how a wave gets dispatched twice.
2. Then act.

To see what is outstanding: `GET /api/mail?to=<your session id>`.

## 4 — Re-measure a claimed wave-done

A `status`/`wave-done` message carries `{branchTip, prNumber, prPhase,
handoffCommit}`. Re-measure each fact yourself (read-only ccd is fine here:
`ccd pr-state --session <worker id>`, and `git -C <worktree> rev-parse` for the
tip), then:

`POST /api/runs/:id/advance` `{"to":"awaiting-review","fingerprint":{…}}`

The **server re-measures too, and its answer wins** (contract clause 6). A
mismatch answers a typed rejection and leaves the run state untouched:

| reject | meaning |
|---|---|
| `stale-tip` | the branch moved after the claim was written |
| `pr-regressed` | the PR is not in the phase the claim asserted |
| `no-handoff-commit` | the last commit is not the ledger-updating handoff |

Mail the code back to the worker (`POST /api/mail`, kind `answer`, subject
`rejected: <code>`) and leave the run alone. A stale `wave-done` must never
settle a wave.

## 5 — The boundary

1. Review the handoff commit the way you would review any commit.
2. Update the ledger — Waves row, Decisions, Carried constraints, and the
   **Next-wave brief**, which is the whole of what the fresh session reads.
   Commit it.
3. `POST /api/sessions/:id/hold` `{"reason":"program:<slug> wave:<N+1>/M"}`.
4. Dispatch wave N+1 into the **same workspace** (step 2). The fresh session's
   first act per its brief is rebasing `ws/<slug>` onto main.

## 6 — Final merge

`POST /api/sessions/:id/release`. The ordinary sweep archives the workspace and
its manifest carries the whole PR lineage. You do not reap, ever (clause 3);
cleanup is the operator's ceremony in the PWA.
```

Create `ccd/coordinator-skill/references/mail-envelope.md`. **The fenced block
below is a placeholder in this plan and must be replaced by the actual output of
`renderEnvelope(fixture)`** — Step 6 prints it and you paste it in. That is not
laziness: the test in Step 1 asserts byte equality, so the only correct source
for this block is the function itself.

```markdown
# The envelope

Mail is injected into your session as a fenced, self-describing block. You need
no tooling to act on it; everything is on the face of it.

<!-- BEGIN renderEnvelope — paste the real output here (Step 6) -->
```

- [ ] **Step 5: Ship the template**

```bash
cp docs/superpowers/programs/TEMPLATE.md ccd/coordinator-skill/references/ledger-template.md
```

`cp`, not a rewrite: the test asserts byte equality (**D-7**). If the copy ever
needs to change, change `docs/superpowers/programs/TEMPLATE.md` and re-run this
line.

- [ ] **Step 6: Print the real envelope and paste it in**

```bash
cd server && npx tsx -e "
import { renderEnvelope } from './src/mail/envelope.js';
process.stdout.write(renderEnvelope({
  id: 'm-0007', at: 1754600000000, fromId: 'ccrc-pwa-clear-cove', toId: 'coordinator',
  runId: 'run-3', kind: 'status', subject: 'wave-done',
  body: 'Wave 3 is on the branch. Handoff commit is the ledger update; PR #591 is green.',
  artifacts: ['docs/superpowers/programs/build4-transcript-surface.md'],
  delivery: 'delivered', rejectCode: null,
}));"
```

Paste the output verbatim into `references/mail-envelope.md` under the BEGIN
marker, then add the two rules beneath it:

```markdown
**Ack before you act.** `POST /api/mail/:id/ack`. Until then the lane replays
this message verbatim on later sweeps.

**Artifacts are paths, never payloads.** Read the file; do not expect its
contents in the body.
```

- [ ] **Step 7: Run the suite**

Run: `cd server && npx vitest run test/coordinator-skill.test.ts`
Expected: PASS, 8 cases. If the route linkage case fails, the skill named a
route PR I did not register — fix the **skill**, and if the route genuinely
should exist, that is a finding against the interface list, not a licence to
delete the assertion.

- [ ] **Step 8: Commit**

```bash
git add ccd/coordinator-skill server/test/coordinator-skill.test.ts
git commit -m "feat(ccd): the coordinator skill, with its contract pinned by a suite"
```

---

### Task 2: the install lane — four homes, and nothing that duplicates PR I

**Files:**
- Create: `ccd/install-coordinator-skill.sh`
- Create: `server/test/install-coordinator-skill.test.ts`
- Modify: `deploy/deploy.sh` — the agent arm only (`:39-82`), after the hook installer at `:66`

**Interfaces:**
- Consumes: `install-session-hooks.sh`'s shape (`:23-25` the four homes and the `--homes` override, `:42-65` the per-home loop with backup + converged-skip); `mkTmp` (`server/test/tmpHelpers.ts`); PR I's `ship_secret` and rewritten `notify.sh` (interface 10) — **depended on and verified, never re-implemented**.
- Produces: `bash install-coordinator-skill.sh [--homes <dir>…]`, exit 0 on success, exit 1 with a message on stderr for any home it refused; three lines in `deploy.sh`'s agent arm.

**Why the installer copies `install-session-hooks.sh` rather than being clever:** skills resolve per `CLAUDE_CONFIG_DIR` (`~/.local/bin/claude2:2`, `claude-corp:2`, `gpt:129`), and a session's account **drifts on swap** — the registry's `wrapper` field changes while the id does not. Operator ruling 2 places the coordinator with `_ws_least_loaded` and no pinned account precisely *because* the four-homes lane makes that safe. An installer that converged three homes and failed the fourth silently would restore the exact hazard the ruling relies on this lane to remove, which is why the loop's `rc=1` is per-home and the exit status is checked by the deploy.

**What this task deliberately does NOT do (D-8):** it does not touch `deploy/notify.sh`, does not add `ship_secret`, does not add the `.gitignore` line and does not create `deploy/ccrc-mail.token.example`. All four are PR I's, already written there. Step 5 asserts they arrived — existence and shape only, never a token's contents — because the skill is useless without them and a silent absence surfaces as a coordinator that cannot authenticate.

- [ ] **Step 1: Write the installer's failing suite**

Create `server/test/install-coordinator-skill.test.ts`:

```ts
// The skill installer, tested exactly the way install-session-hooks.test.ts
// tests its sibling: a fixture HOME, never the live one, and the properties
// that matter are convergence, non-destruction and per-home isolation.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';

const INSTALLER = path.resolve(__dirname, '../../ccd/install-coordinator-skill.sh');
const SRC = path.resolve(__dirname, '../../ccd/coordinator-skill');
const HOMES = ['.claude', '.claude-personal', '.claude-corp', '.claude-gpt'];

let home: string;
const skill = (d: string, ...rest: string[]): string =>
  path.join(home, d, 'skills', 'ccrc-coordinator', ...rest);

beforeEach(() => {
  home = mkTmp('ccrc-skillinstall-');
  for (const d of HOMES) fs.mkdirSync(path.join(home, d), { recursive: true });
});
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

const run = (...homes: string[]): void => {
  execFileSync('bash', [INSTALLER, '--homes', ...(homes.length ? homes : HOMES.map((d) => path.join(home, d)))],
    { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: SRC } });
};

describe('install-coordinator-skill', () => {
  it('installs the skill into every home it is given', () => {
    run();
    for (const d of HOMES) {
      expect(fs.readFileSync(skill(d, 'SKILL.md'), 'utf8'))
        .toBe(fs.readFileSync(path.join(SRC, 'SKILL.md'), 'utf8'));
      expect(fs.existsSync(skill(d, 'references', 'wave-lifecycle.md'))).toBe(true);
      expect(fs.existsSync(skill(d, 'references', 'ledger-template.md'))).toBe(true);
    }
  });

  it('re-running converges — the second run does not rewrite a converged home', () => {
    // Byte-level idempotence is what install-session-hooks promises, and the
    // observable proof here is the inode: a rewrite would replace the file.
    run();
    const before = fs.statSync(skill('.claude', 'SKILL.md'));
    run();
    const after = fs.statSync(skill('.claude', 'SKILL.md'));
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('replaces a stale install and backs the old one up first', () => {
    run();
    fs.writeFileSync(skill('.claude', 'SKILL.md'), 'an older generation of the skill');
    run();
    expect(fs.readFileSync(skill('.claude', 'SKILL.md'), 'utf8')).toContain('name: ccrc-coordinator');
    const backups = fs.readdirSync(path.join(home, 'ccrc-backups'));
    expect(backups.length).toBeGreaterThan(0);
    const inside = fs.readdirSync(path.join(home, 'ccrc-backups', backups[0]!));
    expect(inside.some((n) => n.includes('ccrc-coordinator'))).toBe(true);
  });

  it('skips a home that does not exist without failing the run', () => {
    // A box with three of the four wrappers is an ordinary box, not an error.
    fs.rmSync(path.join(home, '.claude-gpt'), { recursive: true });
    run();
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(true);
  });

  it('refuses the whole run when the source has no SKILL.md, touching nothing', () => {
    const empty = mkTmp('ccrc-skillsrc-');
    expect(() => execFileSync('bash', [INSTALLER, '--homes', path.join(home, '.claude')],
      { env: { ...process.env, HOME: home, CCRC_SKILL_SRC: empty } })).toThrow();
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(false);
    fs.rmSync(empty, { recursive: true, force: true });
  });

  it('reports a failed home in the exit status but still processes the others', () => {
    // Same rule as the hook installer: one bad home must not silently strand
    // the account a swap could move the coordinator onto.
    const blocked = path.join(home, '.claude-corp', 'skills');
    fs.mkdirSync(blocked, { recursive: true });
    fs.chmodSync(blocked, 0o500);
    let threw = false;
    try { run(); } catch { threw = true; }
    fs.chmodSync(blocked, 0o700);
    expect(threw).toBe(true);
    expect(fs.existsSync(skill('.claude', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(skill('.claude-personal', 'SKILL.md'))).toBe(true);
  });

  it('never writes outside the homes it was given', () => {
    run(path.join(home, '.claude'));
    for (const d of ['.claude-personal', '.claude-corp', '.claude-gpt']) {
      expect(fs.existsSync(path.join(home, d, 'skills'))).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && npx vitest run test/install-coordinator-skill.test.ts`
Expected: FAIL — the installer does not exist.

- [ ] **Step 3: Write the installer**

Create `ccd/install-coordinator-skill.sh`:

```bash
#!/usr/bin/env bash
# install-coordinator-skill.sh — put the ccrc coordinator skill in every wrapper
# home's skills dir. Same four-homes, idempotent, backed-up shape as
# install-session-hooks.sh, and for a sharper reason: skills resolve per
# CLAUDE_CONFIG_DIR, and a session's ACCOUNT drifts on swap while its id does
# not. The coordinator is placed like any other session (`_ws_least_loaded`,
# no pinned account — Build 7 operator ruling 2), and this lane is the only
# thing that makes that safe: a swap must never land the coordinator on a home
# without its skill.
#
# Deploy-time only (not a hook hot path): no timing budget here.
set -euo pipefail

# The DEPLOYED source — deploy.sh rsyncs ccd/coordinator-skill/ to
# ~/.cc-sessions/coordinator-skill/ on the fleet host. Overridable so the test
# harness can point it at the repo copy without a deploy.
SRC="${CCRC_SKILL_SRC:-$HOME/.cc-sessions/coordinator-skill}"
NAME=ccrc-coordinator
TS=$(date +%Y%m%d-%H%M%S)
BACKUPS="$HOME/ccrc-backups/$TS"

homes=()
if [[ "${1:-}" == --homes ]]; then shift; homes=("$@")
else homes=("$HOME/.claude" "$HOME/.claude-personal" "$HOME/.claude-corp" "$HOME/.claude-gpt"); fi

# Refuse rather than degrade — ccd's own rule for a missing tool
# (`ccd:2135-2139`: "refusing to run the destructive verb unserialised"). A
# half-installed skill is worse than none: the model would follow whatever
# fragment landed.
[[ -f "$SRC/SKILL.md" ]] || { echo "install-coordinator-skill: no SKILL.md under $SRC — refusing" >&2; exit 1; }
command -v diff >/dev/null 2>&1 \
  || { echo "install-coordinator-skill: diff (diffutils) is unavailable — refusing rather than rewriting blind" >&2; exit 1; }

rc=0
for dir in "${homes[@]}"; do
  [[ -d "$dir" ]] || continue           # three of four wrappers is an ordinary box
  dest="$dir/skills/$NAME"

  # Converged already? Do not touch it. Idempotence is observable: the test
  # asserts the inode and mtime survive a second run.
  if [[ -d "$dest" ]] && diff -r -q "$SRC" "$dest" >/dev/null 2>&1; then continue; fi

  tmp="$dest.tmp.$$"
  old="$dest.old.$$"
  rm -rf "$tmp"
  mkdir -p "$dir/skills" && mkdir -p "$tmp" && cp -a "$SRC/." "$tmp/" \
    || { rm -rf "$tmp"; echo "install-coordinator-skill: could not stage into $dir" >&2; rc=1; continue; }

  if [[ -e "$dest" ]]; then
    mkdir -p "$BACKUPS"
    cp -a "$dest" "$BACKUPS/$(basename "$dir").skills.$NAME" \
      || { rm -rf "$tmp"; echo "install-coordinator-skill: backup failed for $dest" >&2; rc=1; continue; }
    mv "$dest" "$old" || { rm -rf "$tmp"; rc=1; continue; }
  fi

  # The swap, and its rollback: a failed `mv` must leave the home with the
  # skill it had, never with nothing.
  if ! mv "$tmp" "$dest"; then
    rm -rf "$tmp"
    [[ -e "$old" ]] && mv "$old" "$dest"
    echo "install-coordinator-skill: install failed for $dir" >&2
    rc=1
    continue
  fi
  rm -rf "$old"
done
exit "$rc"
```

- [ ] **Step 4: Ship the skill from the agent arm**

Three lines in `deploy/deploy.sh`, immediately after the `install-session-hooks.sh` line (`:66`). **Nothing else in this file is touched by this PR** — `ship_secret` and the token are PR I's (**D-8**).

```bash
  # The coordinator skill is the FOURTH artifact ccrc ships to the fleet host
  # (ccd, session-hook.sh, install-session-hooks.sh, and now this). rsync with
  # --delete so a reference file deleted in git is deleted on the box too — a
  # stale reference is prose a model will still follow.
  "${SSH[@]}" "$BOX" 'mkdir -p ~/.cc-sessions/coordinator-skill'
  rsync -az --delete -e "${SSH[*]}" ccd/coordinator-skill/ "$BOX":.cc-sessions/coordinator-skill/
  "${SCP[@]}" ccd/install-coordinator-skill.sh "$BOX":.cc-sessions/install-coordinator-skill.sh
  "${SSH[@]}" "$BOX" 'chmod +x ~/.cc-sessions/install-coordinator-skill.sh && bash ~/.cc-sessions/install-coordinator-skill.sh'
```

The installer runs **after** the ccd/hook installs and inside the same `&&`-free
sequence they use, so `set -euo pipefail` aborts the deploy on a non-zero exit —
which is exactly what a home the installer could not converge produces.

- [ ] **Step 5: Pin the deploy's shape, and verify PR I's token lane arrived**

Append to `server/test/install-coordinator-skill.test.ts`:

```ts
describe('the deploy ships the skill, agent-side — and PR I’s token lane is there', () => {
  const repo = (f: string): string => readFileSync(path.resolve(__dirname, '../..', f), 'utf8');
  const deploy = repo('deploy/deploy.sh');
  const agentArm = deploy.slice(deploy.indexOf('if [ "$TARGET" = "agent" ]'), deploy.indexOf('\nelse\n'));

  it('installs the skill in the agent arm, after the hook installer', () => {
    expect(agentArm).toContain('coordinator-skill');
    expect(agentArm).toContain('install-coordinator-skill.sh');
    expect(agentArm.indexOf('install-session-hooks.sh'))
      .toBeLessThan(agentArm.indexOf('install-coordinator-skill.sh'));
  });

  it('rsyncs the skill with --delete, so a deleted reference dies on the box too', () => {
    const line = agentArm.split('\n').find((l) => l.includes('coordinator-skill/'))!;
    expect(line).toContain('--delete');
  });

  // The three below are assertions about PR I's work, deliberately. The skill
  // is useless without the token, and a silently absent lane would surface as a
  // coordinator that cannot authenticate — a long way from here. They check
  // SHAPE and EXISTENCE only: no test in this repo reads a token, and a token
  // in a fixture is a token in a CI log.
  it('the agent arm ships the fleet host’s copy of the box token', () => {
    expect(agentArm).toContain("ship_secret ccrc-mail.token '~/.cc-secrets' ccrc-mail.token");
  });

  it('notify.sh presents it under the header the server actually checks', () => {
    expect(repo('deploy/notify.sh')).toContain('x-ccrc-mail-token');
  });

  it('the token is gitignored and no token is committed', () => {
    expect(repo('.gitignore')).toContain('deploy/ccrc-mail.token');
    expect(existsSync(path.resolve(__dirname, '../../deploy/ccrc-mail.token')),
      'a real token must never be committed to this repo').toBe(false);
  });
});
```

(add `existsSync` and `readFileSync` to the `node:fs` imports at the top of that file.)

**If any of the last three fail, PR I has not landed on this branch's base.** That is a reconciliation finding for the orchestrator, not a licence to implement the lane here — two implementations of one secret path is precisely what **D-8** exists to prevent.

- [ ] **Step 6: Run the suites and lint the shell**

Run: `cd server && npx vitest run test/install-coordinator-skill.test.ts test/coordinator-skill.test.ts`
Expected: PASS.

Run: `bash -n ccd/install-coordinator-skill.sh && bash -n deploy/deploy.sh && shellcheck -S error ccd/install-coordinator-skill.sh deploy/deploy.sh || true`
Expected: `bash -n` clean; no *new* shellcheck error attributable to this diff.

- [ ] **Step 7: Commit**

```bash
git add ccd/install-coordinator-skill.sh deploy/deploy.sh server/test/install-coordinator-skill.test.ts
git commit -m "feat(ccd): install the coordinator skill into all four account homes on every agent deploy"
```

---

### Task 3: one comparison, two kinds of key — and a feed that is rendered on receipt

**Files:**
- Modify: `pwa/src/lib/seen.ts` (`isUnseen` `:151-155`, `prune` `:214-226`)
- Modify: `pwa/test/seen.test.ts`
- Create: `pwa/src/lib/feed.ts`
- Create: `pwa/test/feed.test.ts`
- Modify: `pwa/src/lib/api.ts` (the returned object, `:186-260`)
- Modify: `pwa/src/stores/fleet.ts` (`FleetState` `:16-52`, `asFleetMsg` `:54-74`, `connect` `:105-167`)
- Modify: `pwa/test/presence-catchup.test.ts` (`:161`, `:187`, `:206`, `:242`, `:245-255`)
- Modify: `pwa/test/stores.test.ts`

**Interfaces:**
- Consumes: `NotifyEvent` (widened, PR I interface 2), `RunSummary` (interface 1), `GET /api/runs` and `GET /api/feed` (interface 5), `applyCatchUp` (`pwa/src/lib/notifymark.ts:67-70`), `Acks`/`ack`/`save`/`publish` (`seen.ts`).
- Produces: `isUnseenAt(key, since, acks)`, `FEED_ACK_KEY`, `reviveNotifyEvents(raw)`, `mergeBySeq(a, b)`, `FEED_CAP`, `api.runs()`, `api.feed(limit)`, and a fleet store carrying `runs` and `feed` with `mergeFeed`/`ackFeed`/`clearFeed`.

**Three rules this task fixes, all of them load-bearing:**

1. **One comparison, one namespace** (**D-1**). `isUnseenAt` is the comparison; `isUnseen` is its session-shaped caller; `prune` never touches a key containing `:`.
2. **Degrade, never fabricate, never silently drop.** `reviveNotifyEvents` maps an unrecognised `kind` to `'unknown'` and an absent `runId` to `null` — the shared revival rule's two legal moves (`shared/api.ts:585-597`). An event missing `seq` or `at` is the one case it cannot place at all, so it is dropped **and counted**, and the screen says how many. A feed that quietly loses records is the one failure this surface exists to prevent.
3. **Render on receipt.** `notifymark.ts:56-65` says the mark advances one-way at receipt and *"a caller that stores them without rendering them has silently dropped them"*. The slice is therefore no longer called `missed`, and the screen that renders it is shipped in the same PR.

- [ ] **Step 1: Write the failing tests**

Append to `pwa/test/seen.test.ts`:

```ts
import { isUnseenAt, FEED_ACK_KEY } from '../src/lib/seen';

describe('one comparison, two kinds of key', () => {
  it('isUnseen is a caller of isUnseenAt, not a second comparison', () => {
    // Structural, because the whole point is that there is ONE of these
    // (groupFleet.ts's pre-commitment). A copy of `>` against `acks[...]`
    // inside isUnseen would pass every behavioural case here.
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'seen.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function isUnseen('), src.indexOf('\n}', src.indexOf('export function isUnseen(')));
    expect(body).toContain('isUnseenAt(');
    expect(body).not.toMatch(/acks\[[^\]]+\]\s*\?\?\s*0/);
  });

  it('counts an unacked instant as unseen and an acked one as seen', () => {
    expect(isUnseenAt(FEED_ACK_KEY, 5_000, {})).toBe(true);
    expect(isUnseenAt(FEED_ACK_KEY, 5_000, { [FEED_ACK_KEY]: 5_000 })).toBe(false);
    expect(isUnseenAt(FEED_ACK_KEY, 6_000, { [FEED_ACK_KEY]: 5_000 })).toBe(true);
  });

  it('says nothing about an instant it does not have', () => {
    expect(isUnseenAt(FEED_ACK_KEY, null, {})).toBe(false);
  });

  it('prune never deletes a namespaced key — a session id cannot contain a colon', () => {
    // ccd's own id regex is ^[A-Za-z0-9._-]+$ (ccd:1671), which is what makes
    // `ccrc:feed` collision-proof. Without this rule the feed watermark is
    // deleted — and the deletion PERSISTED — within one fleet snapshot.
    ack('cc-a', 1_000);
    ack(FEED_ACK_KEY, 2_000);
    const after = prune(new Set(['cc-a']));
    expect(after[FEED_ACK_KEY]).toBe(2_000);
    expect(after['cc-a']).toBe(1_000);
  });

  it('still prunes an ordinary session id the fleet no longer has', () => {
    ack('cc-a', 1_000);
    ack('cc-gone', 1_000);
    ack(FEED_ACK_KEY, 2_000);
    const after = prune(new Set(['cc-a']));
    expect(after['cc-gone']).toBeUndefined();
    expect(after[FEED_ACK_KEY]).toBe(2_000);
  });

  it('the feed key is namespaced, not a bare word another session could collide with', () => {
    expect(FEED_ACK_KEY).toContain(':');
  });
});
```

Create `pwa/test/feed.test.ts`:

```ts
// The durable feed's client half: degrade an unknown kind, never fabricate an
// event, never silently lose one, and merge two sources by seq.
import { describe, it, expect } from 'vitest';
import { FEED_CAP, mergeBySeq, reviveNotifyEvents } from '../src/lib/feed';
import type { NotifyEvent } from '../../shared/api';

const e = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  seq: 1, at: 1_000, kind: 'mail', sessionId: 'cc-a', title: 't', body: 'b', runId: null, ...over,
});

describe('reviveNotifyEvents', () => {
  it('keeps a known kind exactly as it arrived', () => {
    const { events, dropped } = reviveNotifyEvents([e({ kind: 'run', runId: 'run-3' })]);
    expect(events).toEqual([e({ kind: 'run', runId: 'run-3' })]);
    expect(dropped).toBe(0);
  });

  it('lands a kind from a NEWER build on `unknown` rather than typing it as something it is not', () => {
    // shared/api.ts:585-597's second legal move: a token from a newer build,
    // where the type has a designated we-do-not-know member, becomes that
    // member. Today's closed 3-union has no such branch at all, which is what
    // this exists to fix.
    const { events } = reviveNotifyEvents([{ ...e(), kind: 'ritual-sacrifice' }]);
    expect(events[0]!.kind).toBe('unknown');
    expect(events[0]!.title).toBe('t');
    expect(events[0]!.body).toBe('b');
  });

  it('absent runId is null — an older build lacked the field', () => {
    const raw = { seq: 2, at: 2_000, kind: 'done', sessionId: 'cc-a', title: 't', body: 'b' };
    expect(reviveNotifyEvents([raw]).events[0]!.runId).toBeNull();
  });

  it('drops — and COUNTS — an event with no place in the order', () => {
    // seq and at are the identity and the ordering. Everything else can
    // degrade; these cannot be invented, so the event is dropped and the count
    // is surfaced. A feed that loses a record silently is the failure this
    // whole surface exists to prevent.
    const { events, dropped } = reviveNotifyEvents([e(), { at: 3_000, kind: 'mail' }, e({ seq: 4 })]);
    expect(events.map((x) => x.seq)).toEqual([1, 4]);
    expect(dropped).toBe(1);
  });

  it('answers empty for a body that is not an array at all', () => {
    expect(reviveNotifyEvents(null)).toEqual({ events: [], dropped: 0 });
    expect(reviveNotifyEvents({ events: [] })).toEqual({ events: [], dropped: 0 });
  });

  it('degrades a non-string title/body rather than dropping the record', () => {
    const { events, dropped } = reviveNotifyEvents([{ seq: 9, at: 9, kind: 'mail', sessionId: 'cc-a', title: 7, body: null }]);
    expect(dropped).toBe(0);
    expect(events[0]!.title).toBe('');
    expect(events[0]!.body).toBe('');
  });
});

describe('mergeBySeq', () => {
  it('unions two sources on seq, newest last, with no duplicates', () => {
    const durable = [e({ seq: 1 }), e({ seq: 2 })];
    const live = [e({ seq: 2 }), e({ seq: 3 })];
    expect(mergeBySeq(durable, live).map((x) => x.seq)).toEqual([1, 2, 3]);
  });

  it('lets the LATER source win a seq collision — a re-read is fresher than a cached copy', () => {
    expect(mergeBySeq([e({ seq: 1, title: 'old' })], [e({ seq: 1, title: 'new' })])[0]!.title).toBe('new');
  });

  it('caps the list from the OLD end, so the newest record is never the one dropped', () => {
    const many = Array.from({ length: FEED_CAP + 10 }, (_, i) => e({ seq: i + 1 }));
    const out = mergeBySeq([], many);
    expect(out).toHaveLength(FEED_CAP);
    expect(out.at(-1)!.seq).toBe(FEED_CAP + 10);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd pwa && npx vitest run test/seen.test.ts test/feed.test.ts`
Expected: FAIL — `isUnseenAt` is not exported; `../src/lib/feed` does not resolve.

- [ ] **Step 3: Split the comparison and namespace the map**

In `pwa/src/lib/seen.ts`, replace `isUnseen` (`:147-155`) with:

```ts
/** The ack key for the fleet-wide feed (`/mail`). NAMESPACED with a colon,
 *  which ccd's own id regex (`^[A-Za-z0-9._-]+$`, ccd:1671) forbids in a
 *  session id — so this can never collide with one, and `prune` can tell the
 *  two apart by shape rather than by an allowlist it would have to maintain. */
export const FEED_ACK_KEY = 'ccrc:feed';

/** THE comparison — one implementation, now one level down so that a thing
 *  with no bucket can still be counted by it.
 *
 *  `groupFleet.ts`'s pre-commitment ("a row badge or a bell counter … counts
 *  with `isUnseen` like this does, rather than re-implementing the comparison")
 *  is what this preserves: the feed's unread count reaches the SAME `>` against
 *  the SAME map. It could not reach `isUnseen` itself, because a `NotifyEvent`
 *  has no `bucket` and no `bucketSince` — so the comparison moved rather than
 *  being copied. */
export function isUnseenAt(key: string, since: number | null, acks: Acks): boolean {
  if (since === null) return false;
  return since > (acks[key] ?? 0);
}

/** Every surface that badges an unseen SESSION calls this; it is `isUnseenAt`
 *  with the bucket ladder's own two preconditions in front of it. */
export function isUnseen(s: FleetSession, acks: Acks): boolean {
  if (!BADGED.has(s.bucket)) return false;
  return isUnseenAt(s.id, s.bucketSince, acks);
}
```

and in `prune` (`:214-226`), after `if (live.size === 0) return publish(acks);`:

```ts
  let changed = false;
  for (const id of Object.keys(acks)) {
    // A key containing `:` is not a session id (ccd's id regex forbids the
    // character) — it is a namespaced watermark like FEED_ACK_KEY, and the
    // fleet's session list says nothing about whether it is still wanted.
    // Without this the feed's watermark is deleted on the next snapshot AND
    // the deletion is persisted: the whole feed silently re-badges unread and
    // the real mark is gone. Same class as the empty-fleet guard above —
    // absent evidence proves nothing.
    if (id.includes(':')) continue;
    if (!live.has(id)) { delete acks[id]; changed = true; }
  }
```

- [ ] **Step 4: Write the feed's client half**

Create `pwa/src/lib/feed.ts`:

```ts
// The durable feed's client half.
//
// Two sources, one list. `GET /api/feed` is the durable read (coord.db, so it
// survives the several deploys a day this box takes — the 200-event in-memory
// ring never did); the catch-up response on every socket open is the live tail,
// and `notifymark.ts` advances the durable mark ONE-WAY at the moment that
// response lands. So the tail must be merged and rendered on receipt: there is
// no second chance to ask for it.
import type { NotifyEvent } from '../../../shared/api';

/** How many events the store keeps. Mirrors the server ring's own 200
 *  (server/src/notifylog.ts:6) so the client never pretends to hold more
 *  scrollback than anything upstream can produce in one read. */
export const FEED_CAP = 200;

const KINDS: ReadonlySet<NotifyEvent['kind']> = new Set(['ask', 'done', 'merged', 'mail', 'run', 'unknown']);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Revive a feed response. The three legal moves are `shared/api.ts:585-597`'s,
 * and the fourth — invention — is not available:
 *
 *  - an unrecognised `kind` becomes `'unknown'`, the designated we-do-not-know
 *    member, and the event still renders with its own title and body;
 *  - an absent nullable (`runId`) becomes `null` — an older build lacked it;
 *  - a non-string title/body degrades to `''` rather than taking the record out.
 *
 * `seq` and `at` are the exception: they are the identity and the ordering, and
 * nothing can supply them. An event without both is DROPPED — and counted, so
 * the screen can say how many records this build could not read. A feed that
 * loses a record silently is the one failure this surface exists to prevent,
 * which is why the count travels beside the list rather than being logged.
 */
export function reviveNotifyEvents(raw: unknown): { events: NotifyEvent[]; dropped: number } {
  if (!Array.isArray(raw)) return { events: [], dropped: 0 };
  const events: NotifyEvent[] = [];
  let dropped = 0;
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) { dropped += 1; continue; }
    const o = r as Record<string, unknown>;
    const seq = num(o['seq']);
    const at = num(o['at']);
    if (seq === null || at === null) { dropped += 1; continue; }
    const kind = o['kind'];
    events.push({
      seq, at,
      kind: typeof kind === 'string' && KINDS.has(kind as NotifyEvent['kind'])
        ? (kind as NotifyEvent['kind'])
        : 'unknown',
      sessionId: str(o['sessionId']),
      title: str(o['title']),
      body: str(o['body']),
      runId: typeof o['runId'] === 'string' ? o['runId'] : null,
    });
  }
  return { events, dropped };
}

/** Union two feed sources on `seq`, oldest first, capped from the OLD end.
 *  The later argument wins a collision: a re-read is fresher than a cached
 *  copy, and a catch-up event that also appears in a durable read is the same
 *  record seen twice, never two records. */
export function mergeBySeq(a: readonly NotifyEvent[], b: readonly NotifyEvent[]): NotifyEvent[] {
  const by = new Map<number, NotifyEvent>();
  for (const e of a) by.set(e.seq, e);
  for (const e of b) by.set(e.seq, e);
  const all = [...by.values()].sort((x, y) => x.seq - y.seq);
  return all.length > FEED_CAP ? all.slice(all.length - FEED_CAP) : all;
}
```

- [ ] **Step 5: Two client methods**

In `pwa/src/lib/api.ts`, beside `catchUp`:

```ts
    runs: () => getJson<{ runs: RunSummary[] }>('/api/runs'),
    /** The DURABLE feed. `catchUp` is the live tail and is volatile by
     *  construction (notifymark.ts advances the mark at receipt); this is the
     *  read that still has bodies after a deploy. */
    feed: (limit = 100) => getJson<{ events: NotifyEvent[] }>(`/api/feed?limit=${limit}`),
```

(and add `NotifyEvent`, `RunSummary` to the type import from `../../../shared/api`).

- [ ] **Step 6: The store: `runs`, and `missed` becomes `feed`**

In `pwa/src/stores/fleet.ts`:

```ts
  /** Active AND finished runs, straight off the `{type:'runs'}` frame; the
   *  board splits them on `closedAt`. Empty until the first frame — an older
   *  server never sends one, and `/runs` reads `GET /api/runs` on mount for
   *  exactly that case and for a cold deep link. */
  runs: RunSummary[];
  /**
   * The durable notification feed, rendered by `/mail`.
   *
   * Formerly `missed`, and the rename is the point: `notifymark.ts` advances
   * the watermark ONE-WAY at receipt, so these events can never be asked for
   * again, and its docstring's instruction to whoever renders them first was
   * "must not call it missed, and must render it on receipt". `/mail` ships in
   * the same PR as this rename.
   *
   * Two sources merged on `seq` (lib/feed.ts): the catch-up response on every
   * socket open, and `GET /api/feed` when the screen mounts. Capped at
   * FEED_CAP from the old end.
   */
  feed: NotifyEvent[];
  /** How many records the last read could not place at all (no seq/at). Surfaced
   *  on the screen rather than swallowed. */
  feedDropped: number;
  mergeFeed(events: NotifyEvent[], dropped?: number): void;
  clearFeed(): void;
```

`asFleetMsg` gains one arm, in the same shallow-validation style as `fleet`:

```ts
  if (t === 'runs' && Array.isArray((m as { runs?: unknown }).runs)) {
    return m as FleetMsg;
  }
```

`onMessage` gains the matching arm before the `hello` else:

```ts
            } else if (msg.type === 'runs') {
              set({ runs: msg.runs });
```

and the catch-up handler (`:128-131`) becomes:

```ts
            .then((r) => {
              const events = applyCatchUp(r);
              if (events.length > 0) get().mergeFeed(events);
            })
```

with the mutators:

```ts
      mergeFeed(events, dropped = 0) {
        set((s) => ({ feed: mergeBySeq(s.feed, events), feedDropped: s.feedDropped + dropped }));
      },
      clearFeed() {
        set({ feed: [], feedDropped: 0 });
      },
```

Initial state: `runs: []`, `feed: []`, `feedDropped: 0`. **`feed` is not persisted** to the offline snapshot: `lib/offline.ts` holds the fleet snapshot only, and a stale feed read from localStorage would be indistinguishable from a fresh one on a screen whose whole job is to be a truthful record.

- [ ] **Step 7: Move the two test files off the old name**

In `pwa/test/presence-catchup.test.ts`, `store.getState().missed` → `.feed` at `:161`, `:187`, `:206`, `:242`, `:253`, `:255`, and `clearMissed()` → `clearFeed()` at `:245`/`:254`. **Nothing about those cases' meaning changes** — they pin the serialisation of the catch-up chain, which this task does not touch.

Add to `pwa/test/stores.test.ts`:

```ts
  it('takes a runs frame and drops an unknown one, exactly as before', () => {
    const store = makeStore();
    act(() => { onMessage({ type: 'runs', runs: [{ id: 'run-1', program: 'p', wave: 1 }] }); });
    expect(store.getState().runs).toHaveLength(1);
    act(() => { onMessage({ type: 'lunar-eclipse', payload: 1 }); });
    expect(store.getState().runs).toHaveLength(1);   // unchanged, not cleared
  });

  it('rejects a runs frame whose runs is not an array, rather than coercing it', () => {
    const store = makeStore();
    act(() => { onMessage({ type: 'runs', runs: 'soon' }); });
    expect(store.getState().runs).toEqual([]);
  });
```

(match the file's own harness for `makeStore`/`onMessage` — **the tree wins** over the shape sketched here.)

- [ ] **Step 8: Run the PWA suite**

Run: `cd pwa && npx vitest run && npx tsc --noEmit` (foreground)
Expected: PASS. `groupFleet.test.ts` and `accounts-strip.test.tsx` are the ones to watch: they consume `isUnseen` and the store shape.

- [ ] **Step 9: Commit**

```bash
git add pwa/src/lib/seen.ts pwa/src/lib/feed.ts pwa/src/lib/api.ts pwa/src/stores/fleet.ts \
        pwa/test/seen.test.ts pwa/test/feed.test.ts pwa/test/presence-catchup.test.ts pwa/test/stores.test.ts
git commit -m "feat(pwa): one unseen comparison for two kinds of key, and a feed that is rendered on receipt"
```

---

### Task 4: `/mail` — the feed, and the door that must never render nothing

**Files:**
- Create: `pwa/src/fleet/MailBadge.tsx`
- Create: `pwa/src/screens/MailScreen.tsx`
- Modify: `pwa/src/app.tsx` (`:41-44`, `:52`, `:64-81`)
- Modify: `pwa/src/screens/FleetScreen.tsx` (`.fleet-head-right`, `:206-209`)
- Modify: `pwa/src/fleet/fleet.css`
- Create: `pwa/test/mail-screen.test.tsx`
- Modify: `pwa/test/app.test.tsx`, `pwa/test/tap-targets.test.tsx`

**Interfaces:**
- Consumes: `api.feed` and the store's `feed`/`feedDropped`/`mergeFeed` (Task 3); `isUnseenAt`/`FEED_ACK_KEY`/`ack`/`acksSnapshot`/`subscribeAcks` (`seen.ts`); `navigate`/`usePath` (`lib/router.ts:17,34`); `formatAge` (`pwa/src/fleet/formatReset.ts:19`).
- Produces: `MailBadge({ unread }: { unread: number })`; `MailScreen()`; `FEED_KIND_WORD`.

**The five-part screen anatomy** (`/accounts`, as settled): route regex in the shell; join the `data-view` OR — *"Miss the OR and a phone hides the screen it just navigated to"* (`pwa/test/app.test.tsx:70-79`); render in the detail slot; a back control at the tap floor; **a door**. This screen's door is `MailBadge` (**D-2**), and it inherits `AccountsStrip`'s hard-won rule: **the only door must never render nothing.**

**The presence-gate exemption is surfaced, not buried.** Spec §6: mail *"lands in the feed regardless of watching, and only its push is presence-gated"*. That is a real asymmetry an operator can otherwise only discover by being confused, so the screen states it in one sentence, permanently, above the list — not in a tooltip and not only when the list is empty.

**No glow, and no opacity for "read".** DIRECTION.md refuses glow on non-living things (`:290-291`) and effectively bans element `opacity` over content (`:80-100`); an unread row is marked with a left rule in the accent, and a read row is the plain ground. Kind words are mono (machine voice); the one sentence of explanation is prose, so it is sans.

- [ ] **Step 1: Write the failing tests**

Create `pwa/test/mail-screen.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { NotifyEvent } from '../../shared/api';
import { MailScreen } from '../src/screens/MailScreen';
import { MailBadge } from '../src/fleet/MailBadge';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { FEED_ACK_KEY, acksSnapshot, resetAcks } from '../src/lib/seen';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); resetAcks(); });

const e = (over: Partial<NotifyEvent> = {}): NotifyEvent => ({
  seq: 1, at: Date.now() - 60_000, kind: 'mail', sessionId: 'ccrc-pwa-clear-cove',
  title: '✉ finding › clear-cove', body: 'The hold gate re-reads at the decision point.',
  runId: 'run-3', ...over,
});

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

describe('the mail feed', () => {
  it('renders the durable read AND the live tail, newest last, deduped by seq', async () => {
    const store = makeStore();
    act(() => { store.setState({ feed: [e({ seq: 2, title: 'live' })] }); });
    const feed = vi.fn().mockResolvedValue({ events: [e({ seq: 1, title: 'durable' }), e({ seq: 2, title: 'live' })] });
    render(<MailScreen store={store} loadFeed={feed} />);
    expect(await screen.findByText('durable')).toBeInTheDocument();
    expect(screen.getAllByText('live')).toHaveLength(1);
  });

  it('says the presence-gate truth in words, permanently', () => {
    // Spec §6: a record lands whether or not you were watching; only the PUSH
    // is gated. An operator who learns that from a missing phone ping learns
    // the wrong lesson.
    render(<MailScreen store={makeStore()} loadFeed={async () => ({ events: [] })} />);
    expect(screen.getByText(/whether or not you were watching/i)).toBeInTheDocument();
  });

  it('renders a kind from a newer build rather than hiding the record', () => {
    const store = makeStore();
    act(() => { store.setState({ feed: [e({ kind: 'unknown', title: 'something new', body: 'from a newer build' })] }); });
    render(<MailScreen store={store} loadFeed={async () => ({ events: [] })} />);
    expect(screen.getByText('something new')).toBeInTheDocument();
    expect(screen.getByText('from a newer build')).toBeInTheDocument();
    expect(screen.getByText(/unknown/i)).toBeInTheDocument();
  });

  it('says how many records it could not read at all', () => {
    const store = makeStore();
    act(() => { store.setState({ feed: [e()], feedDropped: 2 }); });
    render(<MailScreen store={store} loadFeed={async () => ({ events: [] })} />);
    expect(screen.getByText(/2 records this build could not read/i)).toBeInTheDocument();
  });

  it('marks unread rows before the ack and none after it', async () => {
    const store = makeStore();
    act(() => { store.setState({ feed: [e({ seq: 1 }), e({ seq: 2 })] }); });
    render(<MailScreen store={store} loadFeed={async () => ({ events: [] })} />);
    // Opening the screen IS the ack — the same rule SessionScreen's mount ack
    // follows (SessionScreen.tsx:78-95).
    await vi.waitFor(() => expect(acksSnapshot()[FEED_ACK_KEY]).toBeGreaterThan(0));
    expect(document.querySelectorAll('[data-unseen="true"]')).toHaveLength(0);
  });

  it('has a back control at the tap floor and an empty state that is not a blank screen', () => {
    render(<MailScreen store={makeStore()} loadFeed={async () => ({ events: [] })} />);
    expect(screen.getByLabelText(/back to fleet/i)).toHaveClass('mail-back');
    expect(screen.getByText(/nothing yet/i)).toBeInTheDocument();
  });
});

describe('the door', () => {
  it('is always rendered — with a count, and without one', () => {
    // AccountsStrip.tsx:9-15's rule, inherited: the ONLY door to a screen may
    // never render nothing, or the screen is unreachable in exactly the state
    // it exists to explain.
    const { rerender } = render(<MailBadge unread={0} />);
    expect(screen.getByRole('button', { name: /mail — nothing unread/i })).toBeInTheDocument();
    rerender(<MailBadge unread={3} />);
    expect(screen.getByRole('button', { name: /mail — 3 unread/i })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('navigates rather than toggling anything', () => {
    render(<MailBadge unread={1} />);
    fireEvent.click(screen.getByRole('button', { name: /mail/i }));
    expect(location.pathname).toBe('/mail');
  });

  it('nests no control inside another', () => {
    // The standing rule (commit ce313de). The bell is a separate button beside
    // this one, never inside it.
    render(<MailBadge unread={1} />);
    const btn = screen.getByRole('button', { name: /mail/i });
    expect(btn.querySelector('button')).toBeNull();
  });

  it('caps the printed count so a three-digit number cannot blow the head open', () => {
    render(<MailBadge unread={412} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mail — 412 unread/i })).toBeInTheDocument();
  });
});
```

Add to `pwa/test/app.test.tsx`:

```tsx
describe('App /mail route', () => {
  it('renders MailScreen and joins [data-view="session"] like every other non-fleet route', () => {
    navigate('/mail');
    render(<App />);
    expect(screen.getByRole('heading', { name: /^mail$/i })).toBeInTheDocument();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-view', 'session');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd pwa && npx vitest run test/mail-screen.test.tsx test/app.test.tsx` → FAIL, unresolved imports.

- [ ] **Step 3: Write the door**

Create `pwa/src/fleet/MailBadge.tsx`:

```tsx
// The door to /mail, and the feed's unread count.
//
// NOT a badge painted on the bell. `NotificationBell` is an aria-pressed toggle
// for Web Push; a count on it would make one control report one fact and do an
// unrelated thing (DIRECTION.md: "no state the user has to interpret"), and
// /mail would have no entry point at all. So this is a SIBLING button beside
// the bell — and, being the only door, it is always rendered, exactly as
// AccountsStrip must always render for /accounts (AccountsStrip.tsx:9-15).
import type { ReactNode } from 'react';
import { navigate } from '../lib/router';
import './fleet.css';

/** Printed cap. The accessible name still carries the REAL number — a count a
 *  screen reader announces as "99 plus" when it is 412 is a different lie from
 *  a narrow chip. */
const PRINT_CAP = 99;

export function MailBadge({ unread }: { unread: number }): ReactNode {
  return (
    <button
      type="button"
      className="mail-badge"
      data-unread={unread > 0 ? 'true' : 'false'}
      aria-label={unread > 0 ? `Mail — ${unread} unread` : 'Mail — nothing unread'}
      onClick={() => navigate('/mail')}
    >
      <span className="mail-badge-glyph" aria-hidden="true">✉</span>
      {unread > 0 && (
        <span className="mail-badge-count">{unread > PRINT_CAP ? `${PRINT_CAP}+` : unread}</span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Write the screen**

Create `pwa/src/screens/MailScreen.tsx`:

```tsx
// The fleet-wide feed — the first surface in this app to render what the
// server recorded rather than what the fleet currently is.
//
// Two sources, one list (lib/feed.ts): `GET /api/feed` is the durable read that
// survives a deploy, and the catch-up response on every socket open is the live
// tail, which is volatile by construction — notifymark.ts advances the mark
// one-way at receipt, so a caller that stores those events without rendering
// them has silently dropped them. This is the renderer that docstring was
// waiting for.
//
// Opening this screen IS the ack, the same rule SessionScreen's mount ack
// follows. One watermark for the whole feed (FEED_ACK_KEY), because "have I
// read my mail" is one question, not one per sender.
import { useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { NotifyEvent } from '../../../shared/api';
import { reviveNotifyEvents } from '../lib/feed';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { ack, acksSnapshot, FEED_ACK_KEY, isUnseenAt, subscribeAcks } from '../lib/seen';
import { useNow } from '../lib/useNow';
import { formatAge } from '../fleet/formatReset';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import '../fleet/fleet.css';

/** The feed's own small vocabulary. Deliberately NOT NotifyEvent['kind']
 *  rendered raw: `merged` is a git word, `run` is a noun the board owns, and
 *  `unknown` has to read as an honest answer rather than as a bug. */
const KIND_WORD: Record<NotifyEvent['kind'], string> = {
  mail: 'mail', run: 'run', ask: 'asked', done: 'finished', merged: 'merged', unknown: 'unknown',
};
const KIND_GLYPH: Record<NotifyEvent['kind'], string> = {
  mail: '✉', run: '⟳', ask: '?', done: '✓', merged: '⑂', unknown: '·',
};

export function MailScreen({
  store = useFleetStore,
  loadFeed = () => api.feed(100),
}: {
  store?: FleetStore;
  loadFeed?: () => Promise<{ events: NotifyEvent[] }>;
}): ReactNode {
  const feed = store((s) => s.feed);
  const dropped = store((s) => s.feedDropped);
  const acks = useSyncExternalStore(subscribeAcks, acksSnapshot);
  const now = useNow(30_000);

  // The durable read, once per mount. Revived rather than trusted: `CatchUp`
  // has been consumed by a bare getJson since it shipped, and a kind from a
  // newer server reaching an old client typed as one of three things it is not
  // is exactly what that bareness costs.
  useEffect(() => {
    let live = true;
    void loadFeed()
      .then((r) => {
        if (!live) return;
        const { events, dropped: d } = reviveNotifyEvents(r.events);
        store.getState().mergeFeed(events, d);
      })
      .catch(() => { /* offline, or an older server with no such route */ });
    return () => { live = false; };
  }, [store, loadFeed]);

  // Opening the screen is the ack. Floored to the newest record's own instant
  // (seen.ts's `stampFor`) so a device behind the fleet host's clock does not
  // ack into the past and leave the badge stuck.
  const newest = feed.length > 0 ? feed[feed.length - 1]!.at : null;
  useEffect(() => {
    if (newest !== null) ack(FEED_ACK_KEY, Date.now(), newest);
  }, [newest]);

  const rows = [...feed].reverse();   // newest first on screen; oldest-first in the store
  const nowSec = Math.floor(now / 1000);

  return (
    <div className="mail-screen">
      <header className="mail-head">
        <button type="button" className="mail-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </button>
        <h1 className="mail-title">Mail</h1>
      </header>

      {/* The presence-gate asymmetry, said once and permanently. A record is
          written whatever the operator was looking at; only the phone ping is
          held back for a session already on screen. Prose, so it is sans. */}
      <p className="mail-note">
        Records land here whether or not you were watching — only the phone ping is held back for a
        session you already have open.
      </p>

      {dropped > 0 && (
        <p className="mail-dropped" role="status">
          {dropped} records this build could not read — they are still on the server.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mail-empty">Nothing yet.</p>
      ) : (
        <ul className="mail-list">
          {rows.map((ev) => (
            <li
              key={ev.seq}
              className="mail-row"
              data-unseen={isUnseenAt(FEED_ACK_KEY, ev.at, acks) ? 'true' : 'false'}
            >
              <span className="mail-kind">
                <span className="mail-kind-glyph" aria-hidden="true">{KIND_GLYPH[ev.kind]}</span>
                {KIND_WORD[ev.kind]}
              </span>
              <span className="mail-row-title">{ev.title}</span>
              <span className="mail-when">{formatAge(nowSec - Math.floor(ev.at / 1000))}</span>
              {ev.body !== '' && <p className="mail-body">{ev.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

**Why the row is not a link.** Half these records name a session (`sessionId`) and half name a run; a row that navigated somewhere would have to guess which, and a dead button for a session already reaped is worse than an inert row. v1 is a record you read. (Push copy stays actionless in v1 for the same reason — spec §6.)

- [ ] **Step 5: Mount the route and the door**

`pwa/src/app.tsx` — add beside the other route tests (`:43-44`):

```tsx
  const mail = /^\/mail\/?$/.test(path);
```

join the OR (`:52`) — **this line is the one that decides whether a phone can see the screen at all**:

```tsx
      <div className="app-shell" data-view={sessionId || archive || accounts || mail ? 'session' : 'fleet'}>
```

(Task 5 adds `|| runs` to this same expression, and its own case in `app.test.tsx` fails until it does.)

and add the arm in the detail chain (after the `accounts` arm, `:71-72`):

```tsx
          ) : mail ? (
            <MailScreen />
```

`pwa/src/screens/FleetScreen.tsx` — the head's right cluster (`:206-209`) becomes:

```tsx
        <div className="fleet-head-right">
          {sessions.length > 0 && <span className="fleet-count">{countLine}</span>}
          <MailBadge unread={unreadMail} />
          <NotificationBell />
        </div>
```

with, beside the existing `waiting`/`countLine` derivation:

```tsx
  // The feed's unread count, through the SAME comparison the bucket chips use
  // (seen.ts's isUnseenAt — see groupFleet.ts:30-44's pre-commitment). `acks`
  // is already subscribed on this screen, so this costs one filter.
  const feed = useStore((s) => s.feed);
  const unreadMail = feed.filter((ev) => isUnseenAt(FEED_ACK_KEY, ev.at, acks)).length;
```

- [ ] **Step 6: The stylesheet**

Append to `pwa/src/fleet/fleet.css`. Every rule that carries text is **self-grounded** (background + colour on the one rule) so `design/audit.mjs` measures it without a hand-registered pair — the bucket chips' own trick (`fleet.css:66-80`).

```css
/* — Build 7: the mail door and the feed —
   No glow anywhere below: a record is not a living pane (DIRECTION.md's
   refused list). "Unread" is a rule in the accent on the leading edge, never
   element opacity over content (DIRECTION.md:80-100) and never a hue that
   belongs to state. */
.mail-badge {
  display: inline-flex; align-items: center; gap: var(--sp-1);
  min-width: var(--tap-min); min-height: var(--tap-min);
  border: 0; border-radius: var(--r-sm);
  background: none; color: var(--ink-secondary);
  font: var(--weight-regular) var(--text-base) / 1 var(--font-ui);
  cursor: pointer;
  transition: transform var(--dur-press) var(--ease-swift), color var(--dur-fast) var(--ease-swift);
}
.mail-badge:active { transform: scale(0.88); color: var(--ink-primary); }
.mail-badge[data-unread='true'] { color: var(--ink-primary); }
.mail-badge-count {
  background: var(--status-attention-tint); color: var(--status-attention-text);
  border-radius: var(--r-full); padding: 0 6px;
  font: var(--weight-semibold) var(--text-2xs) / 1.6 var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.mail-screen { display: grid; gap: var(--sp-2); padding: var(--sp-2); }
.mail-head { display: flex; align-items: center; gap: var(--sp-2); }
.mail-back {
  flex: none; min-width: var(--tap-min); min-height: var(--tap-min);
  border: none; background: none; border-radius: var(--r-sm);
  font: var(--weight-regular) 26px / 1 var(--font-ui); color: var(--ink-secondary); cursor: pointer;
  transition: transform var(--dur-press) var(--ease-swift), color var(--dur-fast) var(--ease-swift);
}
.mail-back:active { transform: scale(0.88); color: var(--ink-primary); }
.mail-title { font: var(--weight-medium) var(--text-base) / var(--leading-tight) var(--font-mono); color: var(--ink-primary); }
.mail-note { font-size: var(--text-xs); color: var(--ink-secondary); }
.mail-dropped { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--ink-secondary); }
.mail-empty { padding: var(--sp-4); color: var(--ink-secondary); }
.mail-list { display: grid; gap: var(--sp-1); }
.mail-row {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--sp-2); align-items: baseline;
  padding: var(--sp-2); border-left: 2px solid transparent;
  background: var(--bg-surface); color: var(--ink-primary); border-radius: var(--r-md);
}
.mail-row[data-unseen='true'] { border-left-color: var(--accent); }
.mail-kind {
  display: inline-flex; align-items: baseline; gap: var(--sp-1);
  font: var(--weight-medium) var(--text-2xs) / 1.6 var(--font-mono); color: var(--ink-tertiary);
}
.mail-row-title { font-family: var(--font-mono); font-size: var(--text-sm); }
.mail-when {
  font-family: var(--font-mono); font-size: var(--text-2xs);
  font-variant-numeric: tabular-nums; color: var(--ink-tertiary);
}
.mail-body { grid-column: 1 / -1; font-size: var(--text-xs); color: var(--ink-secondary); }
```

- [ ] **Step 7: Both halves of the tap gate**

In `pwa/test/tap-targets.test.tsx`, add `.mail-badge` and `.mail-back` — the scrape **and** the render:

```tsx
describe('.mail-badge — the only door to /mail', () => {
  it('is at least one tap square, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.mail-badge'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(fleetCss, '.mail-badge'), 'min-width')).toBe('var(--tap-min)');
  });
  it('is the class the rendered head control actually carries', () => {
    render(<MailBadge unread={0} />);
    expect(screen.getByRole('button', { name: /mail/i })).toHaveClass('mail-badge');
  });
});

describe('.mail-back — the feed’s back control', () => {
  it('is at least one tap square, off the shared token', () => {
    expect(declValue(ruleIn(fleetCss, '.mail-back'), 'min-height')).toBe('var(--tap-min)');
  });
  it('is the class the rendered control actually carries', () => {
    render(<MailScreen store={makeStore()} loadFeed={async () => ({ events: [] })} />);
    expect(screen.getByLabelText(/back to fleet/i)).toHaveClass('mail-back');
  });
});
```

and add both rules to the existing *never a bare 44px literal* loop (`:193-206`).

- [ ] **Step 8: Run the PWA suite and the design gates**

Run: `cd pwa && npx vitest run && npx tsc --noEmit && node design/contrast-check.mjs` (foreground)
Expected: PASS, and the contrast gate reports the new rules as measured. If it refuses one, make the rule self-grounded rather than registering a pair — that is the cheap path and the one the bucket chips took.

- [ ] **Step 9: Commit**

```bash
git add pwa/src/fleet/MailBadge.tsx pwa/src/screens/MailScreen.tsx pwa/src/app.tsx \
        pwa/src/screens/FleetScreen.tsx pwa/src/fleet/fleet.css \
        pwa/test/mail-screen.test.tsx pwa/test/app.test.tsx pwa/test/tap-targets.test.tsx
git commit -m "feat(pwa): /mail renders the durable feed, and the bell gets a neighbour rather than a second job"
```

---

### Task 5: `/runs` — the board, with its own vocabulary and no glow

**Files:**
- Create: `pwa/src/fleet/runWords.ts`
- Create: `pwa/src/screens/RunsScreen.tsx`
- Modify: `pwa/src/app.tsx` (route, the OR, the detail arm)
- Modify: `pwa/src/screens/FleetScreen.tsx` (the footer, above `.fleet-archived-row` at `:371`)
- Modify: `pwa/src/fleet/fleet.css`
- Create: `pwa/test/runs-screen.test.tsx`
- Modify: `pwa/test/app.test.tsx`, `pwa/test/tap-targets.test.tsx`, `pwa/test/fleet-css.test.ts`

**Interfaces:**
- Consumes: `RunSummary`/`RunState`/`RunTally` (PR I interface 1), the `{type:'runs'}` frame and the store's `runs` (Task 3), `api.runs()` (Task 3), `formatAge`, `navigate`.
- Produces: `RUN_WORD`, `RUN_GLYPH`, `RUN_ORDER`, `runsByProgram(runs)`; `RunsScreen()`.

**The door, decided deliberately.** `/accounts`'s door is a permanently-mounted strip; `/archive`'s is a footer row that appears with its first archived workspace. The run board takes the **footer row**, immediately above `.fleet-archived-row`, and — unlike the archive row — it renders **whenever the populated arm renders**, including with zero runs (`Runs · none active`). Two reasons, both from things this repo already paid for: it is the only door (so it must never render nothing, `AccountsStrip.tsx:9-15`), and a *permanent* head control for a fleet that is not running a program would be chrome that earns nothing on the phone's most crowded row — which the head already has two new neighbours on after Task 4. A footer row costs one line, sits where the other fleet-wide list already lives, and is at the tap floor by the same rule.

**Its own status table, not `SessionBucket`'s** (spec §6). A run's states are lifecycle positions, not attention states; borrowing `SessionBucket`'s words would put `attention` amber on a row nobody is waiting on, and DIRECTION.md's hue governance (`:59-78`) is explicit that the same hue must mean the same thing everywhere. So: one small table in one file, two cues per row (glyph **and** word — `StatusDot`'s two-glyph discipline, `:226-228`), and **no glow, no `animation`** on any run rule, asserted in the stylesheet test.

**Grouping is a `role="group"`, never a `<section aria-label>`** — the bucket bar's written reason (`FleetScreen.tsx:288-294`): named regions containing nothing turn the landmark rotor into dead ends, and a program with one finished run would do exactly that.

- [ ] **Step 1: Write the failing tests**

Create `pwa/test/runs-screen.test.tsx`:

```tsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { RunSummary } from '../../shared/api';
import { RunsScreen } from '../src/screens/RunsScreen';
import { RUN_WORD } from '../src/fleet/runWords';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const r = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 'run-3', program: 'build4-transcript-surface', wave: 3, waves: 4,
  sessionId: 'ccrc-pwa-clear-cove', workspace: 'clear-cove', branch: 'ws/clear-cove',
  state: 'working', dispatchedAt: Date.now() - 900_000, closedAt: null,
  holdReason: 'program:build4-transcript-surface wave:3/4',
  items: { total: 7, done: 3, failed: 0, blocked: 1 }, ...over,
});

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

describe('the run board', () => {
  it('renders the frame’s runs and never asks REST when the frame already answered', async () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()] }); });
    const load = vi.fn().mockResolvedValue({ runs: [] });
    render(<RunsScreen store={store} loadRuns={load} />);
    expect(screen.getByText('clear-cove')).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });

  it('cold-starts from GET /api/runs when no frame has landed', async () => {
    // The deep-link case, and the older-server case: /ws/fleet may never send
    // a runs frame at all, and a blank board would be a lie about the program.
    const store = makeStore();
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [r()] })} />);
    expect(await screen.findByText('clear-cove')).toBeInTheDocument();
  });

  it('groups by program, and the group is a role=group — not a landmark', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ id: 'a', wave: 1, state: 'done', closedAt: 1 }), r({ id: 'b' })] }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    const group = screen.getByRole('group', { name: /build4-transcript-surface/i });
    expect(group.tagName).toBe('DIV');
    expect(document.querySelectorAll('section[aria-label]')).toHaveLength(0);
  });

  it('says the wave and the work-item tally, in tabular mono', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()] }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByText('wave 3/4')).toBeInTheDocument();
    expect(screen.getByText('3/7')).toBeInTheDocument();
    expect(screen.getByText(/1 blocked/i)).toBeInTheDocument();
  });

  it('carries BOTH cues — a word and a glyph — for every state', () => {
    // StatusDot's discipline: "no state the user has to interpret from a status
    // dot alone". A run board that colour-coded alone would fail the same rule.
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ state: 'awaiting-review' })] }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByText(RUN_WORD['awaiting-review'])).toBeInTheDocument();
    expect(document.querySelector('.run-glyph')).not.toBeNull();
  });

  it('lands a state from a newer build on `unknown` instead of rendering an empty cell', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ state: 'unknown' })] }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByText(RUN_WORD.unknown)).toBeInTheDocument();
  });

  it('splits finished runs out on closedAt, and says so', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ id: 'a', wave: 1, state: 'done', closedAt: Date.now() - 1 }), r({ id: 'b' })] }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByRole('group', { name: /finished/i })).toBeInTheDocument();
  });

  it('opens the run’s session — and renders an INERT row when there is no session to open', () => {
    const store = makeStore();
    act(() => { store.setState({ runs: [r()] }); });
    const { rerender } = render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    fireEvent.click(screen.getByRole('button', { name: /clear-cove/i }));
    expect(location.pathname).toBe('/s/ccrc-pwa-clear-cove');

    act(() => { store.setState({ runs: [r({ sessionId: null, state: 'planned' })] }); });
    rerender(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    // A dead button that navigates to a session that does not exist is worse
    // than a row you cannot tap.
    expect(screen.queryByRole('button', { name: /clear-cove/i })).toBeNull();
  });

  it('shows the hold reason verbatim and never parses it', () => {
    // registry.ts:27 — "the reason string IS the display, no parsing". The run
    // row's own `wave` column is where the number comes from.
    const store = makeStore();
    act(() => { store.setState({ runs: [r({ holdReason: 'program:whatever the operator typed' })] }); });
    render(<RunsScreen store={store} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByTitle('program:whatever the operator typed')).toBeInTheDocument();
  });

  it('has a back control at the tap floor, and an empty state that explains itself', () => {
    render(<RunsScreen store={makeStore()} loadRuns={async () => ({ runs: [] })} />);
    expect(screen.getByLabelText(/back to fleet/i)).toHaveClass('runs-back');
    expect(screen.getByText(/no runs/i)).toBeInTheDocument();
  });
});
```

Add to `pwa/test/app.test.tsx` the `/runs` twin of the `/mail` case (route renders, `data-view="session"`), and to `pwa/test/fleet-css.test.ts`:

```ts
describe('runs are not living panes', () => {
  it('no run rule glows, breathes or animates', () => {
    // DIRECTION.md's refused list, by name: "glow on non-living things". A run
    // row is a record of a lifecycle position; the pane it names may be alive,
    // and THAT row (the fleet line) is where the lamp belongs.
    for (const sel of ['.run-row', '.run-glyph', '.run-state', '.runs-group', '.fleet-runs-row']) {
      const rule = norm(stripComments(ruleIn(css, sel)));
      expect(rule, sel).not.toContain('--glow');
      expect(rule, sel).not.toContain('animation');
      expect(rule, sel).not.toContain('box-shadow');
    }
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd pwa && npx vitest run test/runs-screen.test.tsx test/fleet-css.test.ts` → FAIL, unresolved import / no rule for `.run-row`.

- [ ] **Step 3: The vocabulary, in one small file**

Create `pwa/src/fleet/runWords.ts`:

```ts
// The run board's status vocabulary. Its OWN small table, deliberately not
// SessionBucket's (spec §6): a run state is a lifecycle position, not an
// attention state, and reusing the bucket words would put attention-amber on a
// row nobody is waiting on — against DIRECTION.md's rule that a hue means the
// same thing everywhere.
//
// Two cues per row, always: the word is the fact and the glyph is the shape, so
// no state has to be read out of colour (StatusDot.tsx's own discipline).
import type { RunState, RunSummary } from '../../../shared/api';

export const RUN_WORD: Record<RunState, string> = {
  planned: 'planned',
  dispatched: 'dispatched',
  working: 'working',
  'awaiting-review': 'awaiting review',
  merging: 'merging',
  closing: 'closing',
  done: 'done',
  failed: 'failed',
  /** The designated we-do-not-know member. A state this build has never heard
   *  of renders as an honest "unknown", never as a blank cell and never as
   *  whichever neighbouring word happened to be the default. */
  unknown: 'unknown',
};

export const RUN_GLYPH: Record<RunState, string> = {
  planned: '·', dispatched: '❯', working: '■', 'awaiting-review': '?',
  merging: '⑂', closing: '↩', done: '✓', failed: '✕', unknown: '·',
};

/** Board order: the ones that can move first, the ones that are over last.
 *  One constant, shared by the grouping and the sort, so the two cannot drift —
 *  the same shape `sortFleet.ts`'s RANK/BUCKET_ORDER pair has. */
export const RUN_ORDER: readonly RunState[] = [
  'awaiting-review', 'failed', 'working', 'dispatched', 'merging', 'closing', 'planned', 'done', 'unknown',
];

const rank = (s: RunState): number => {
  const i = RUN_ORDER.indexOf(s);
  return i === -1 ? RUN_ORDER.length : i;
};

/** Runs grouped by program slug, each group's runs newest wave first, groups
 *  ordered by their most urgent member — the same rule `groupFleet` follows,
 *  and for the same reason: a fold must never bury the row that can move. */
export function runsByProgram(runs: readonly RunSummary[]): { program: string; runs: RunSummary[] }[] {
  const by = new Map<string, RunSummary[]>();
  for (const run of [...runs].sort((a, b) => rank(a.state) - rank(b.state) || b.wave - a.wave)) {
    const list = by.get(run.program);
    if (list) list.push(run);
    else by.set(run.program, [run]);
  }
  return [...by].map(([program, list]) => ({ program, runs: list }));
}
```

- [ ] **Step 4: The screen**

Create `pwa/src/screens/RunsScreen.tsx`:

```tsx
// The run board. `/accounts`'s anatomy, run over a different list: route regex,
// the data-view OR, the detail slot, a back control at the tap floor, one door.
//
// Live data rides the `{type:'runs'}` frame on /ws/fleet — additive, dropped
// silently by any client that predates it, and it inherits the socket's
// reconnect/backoff for free. `GET /api/runs` is the COLD start only: a deep
// link straight to /runs, and a server too old to send the frame. Polling it
// would be a fourth cadence for data that changes on human timescales.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { RunSummary } from '../../../shared/api';
import { RUN_GLYPH, RUN_WORD, runsByProgram } from '../fleet/runWords';
import { formatAge } from '../fleet/formatReset';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { useNow } from '../lib/useNow';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import '../fleet/fleet.css';

function RunRow({ run, nowSec }: { run: RunSummary; nowSec: number }): ReactNode {
  const body = (
    <>
      <span className="run-glyph" aria-hidden="true">{RUN_GLYPH[run.state]}</span>
      <span className="run-state">{RUN_WORD[run.state]}</span>
      <span className="run-ws">{run.workspace ?? run.branch ?? run.id}</span>
      <span className="run-tally">{run.items.done}/{run.items.total}</span>
      {run.items.blocked > 0 && <span className="run-blocked">{run.items.blocked} blocked</span>}
      {run.items.failed > 0 && <span className="run-failed">{run.items.failed} failed</span>}
      <span className="run-when">
        {run.dispatchedAt === null ? '—' : formatAge(nowSec - Math.floor(run.dispatchedAt / 1000))}
      </span>
      {/* The hold reason, VERBATIM and never parsed (registry.ts:27). The wave
          number on the group header comes from the run row's own column. */}
      {run.holdReason !== null && (
        <span className="run-held" title={run.holdReason}>held</span>
      )}
    </>
  );
  // A run with no session has nothing to open. An inert row says that; a button
  // that navigates to a session that does not exist says something false.
  return run.sessionId === null
    ? <li className="run-row" data-inert="true">{body}</li>
    : (
      <li className="run-row">
        <button type="button" className="run-open" onClick={() => navigate(`/s/${encodeURIComponent(run.sessionId!)}`)}>
          {body}
        </button>
      </li>
    );
}

export function RunsScreen({
  store = useFleetStore,
  loadRuns = () => api.runs(),
}: {
  store?: FleetStore;
  loadRuns?: () => Promise<{ runs: RunSummary[] }>;
}): ReactNode {
  const live = store((s) => s.runs);
  const [cold, setCold] = useState<RunSummary[] | null>(null);
  const now = useNow(30_000);
  const nowSec = Math.floor(now / 1000);

  useEffect(() => {
    // Only when the frame has said nothing at all. An empty `runs` from a
    // server that DID send the frame is a true empty board, and re-asking would
    // make a cold read race a live one for the same answer.
    if (store.getState().runs.length > 0) return;
    let alive = true;
    void loadRuns().then((r) => { if (alive) setCold(r.runs); }).catch(() => {});
    return () => { alive = false; };
  }, [store, loadRuns]);

  const runs = live.length > 0 ? live : cold ?? [];
  const active = runs.filter((r) => r.closedAt === null);
  const finished = runs.filter((r) => r.closedAt !== null)
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));

  return (
    <div className="runs-screen">
      <header className="runs-head">
        <button type="button" className="runs-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </button>
        <h1 className="runs-title">Runs</h1>
      </header>

      {runs.length === 0 ? (
        <p className="runs-empty">No runs. A program starts when a coordinator opens one.</p>
      ) : (
        <>
          {runsByProgram(active).map(({ program, runs: list }) => {
            const head = list[0]!;
            // `role="group"`, NOT `<section aria-label>`: seven named regions
            // holding nothing turn the landmark rotor into dead ends
            // (FleetScreen.tsx:288-294). The same reasoning, one screen over.
            return (
              <div key={program} className="runs-group" role="group" aria-label={`program ${program}`}>
                <p className="runs-group-head">
                  <span className="runs-program">{program}</span>
                  <span className="runs-wave">wave {head.wave}{head.waves === null ? '' : `/${head.waves}`}</span>
                </p>
                <ul className="runs-list">
                  {list.map((run) => <RunRow key={run.id} run={run} nowSec={nowSec} />)}
                </ul>
              </div>
            );
          })}

          {finished.length > 0 && (
            <div className="runs-group" role="group" aria-label={`finished (${finished.length})`}>
              <p className="runs-group-head"><span className="runs-program">Finished</span></p>
              <ul className="runs-list">
                {finished.map((run) => <RunRow key={run.id} run={run} nowSec={nowSec} />)}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: The route and the door**

`pwa/src/app.tsx`: `const runs = /^\/runs\/?$/.test(path);`, add `|| runs` to the `data-view` OR, and the arm `) : runs ? (<RunsScreen />`.

`pwa/src/screens/FleetScreen.tsx`, immediately **above** the `.fleet-archived-row` footer (`:371`):

```tsx
      {/* The only door to /runs, so it renders whenever this arm does —
          including with nothing running. `.fleet-archived-row` may come and go
          with its own count because /archive has a second route in from every
          project card's sub-fold; this one has no second route. */}
      <button
        type="button"
        className="fleet-runs-row"
        aria-label={activeRuns > 0 ? `Runs · ${activeRuns} active` : 'Runs · none active'}
        onClick={() => navigate('/runs')}
      >
        Runs · {activeRuns > 0 ? `${activeRuns} active` : 'none active'}
      </button>
```

with `const activeRuns = useStore((s) => s.runs).filter((r) => r.closedAt === null).length;` beside the other derivations.

- [ ] **Step 6: The stylesheet**

Append to `pwa/src/fleet/fleet.css` — self-grounded, mono, tabular, and **nothing that glows**:

```css
/* — Build 7: the run board. Machine voice throughout (ids, slugs, waves and
   tallies are all things the fleet says, not things a person wrote), and NO
   glow, no breathe, no box-shadow: a run is a record of a lifecycle position.
   The pane it names may well be alive — and the fleet line, which is where the
   lamp lives, is one tap away. */
.fleet-runs-row {
  min-height: var(--tap-min); width: 100%; padding: 0 var(--sp-2);
  background: none; border: 0; cursor: pointer; text-align: left;
  font-family: var(--font-mono); font-size: var(--text-xs); color: var(--ink-tertiary);
}
.runs-screen { display: grid; gap: var(--sp-3); padding: var(--sp-2); }
.runs-head { display: flex; align-items: center; gap: var(--sp-2); }
.runs-back {
  flex: none; min-width: var(--tap-min); min-height: var(--tap-min);
  border: none; background: none; border-radius: var(--r-sm);
  font: var(--weight-regular) 26px / 1 var(--font-ui); color: var(--ink-secondary); cursor: pointer;
  transition: transform var(--dur-press) var(--ease-swift), color var(--dur-fast) var(--ease-swift);
}
.runs-back:active { transform: scale(0.88); color: var(--ink-primary); }
.runs-title { font: var(--weight-medium) var(--text-base) / var(--leading-tight) var(--font-mono); color: var(--ink-primary); }
.runs-empty { padding: var(--sp-4); color: var(--ink-secondary); }
.runs-group { display: grid; gap: var(--sp-1); }
.runs-group-head {
  display: flex; align-items: baseline; gap: var(--sp-2);
  background: var(--bg-surface); color: var(--ink-primary);
  border-radius: var(--r-md); padding: var(--sp-1) var(--sp-3);
  font: var(--weight-medium) var(--text-xs) / 1.6 var(--font-mono);
}
.runs-program { font-family: var(--font-mono); }
.runs-wave { font-variant-numeric: tabular-nums; color: var(--ink-tertiary); }
.runs-list { display: grid; gap: var(--sp-1); }
.run-row {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2);
  min-height: var(--tap-min); padding: 0 var(--sp-2);
  background: var(--bg-surface); color: var(--ink-primary); border-radius: var(--r-md);
  font-family: var(--font-mono); font-size: var(--text-sm);
}
.run-open {
  display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sp-2);
  width: 100%; min-height: var(--tap-min); padding: 0;
  background: none; border: 0; cursor: pointer; text-align: left;
  color: var(--ink-primary); font: inherit;
}
.run-glyph { color: var(--ink-tertiary); }
.run-state { font-size: var(--text-xs); color: var(--ink-secondary); }
.run-ws { font-size: var(--text-sm); }
.run-tally, .run-blocked, .run-failed, .run-when {
  font-size: var(--text-2xs); font-variant-numeric: tabular-nums; color: var(--ink-tertiary);
}
.run-held { font-size: var(--text-2xs); color: var(--ink-secondary); }
```

- [ ] **Step 7: Both halves of the tap gate, again**

In `pwa/test/tap-targets.test.tsx`: scrape `.fleet-runs-row`, `.runs-back`, `.run-row`, `.run-open` for `min-height: var(--tap-min)`; render `FleetScreen` with one session to prove the footer row carries `.fleet-runs-row`, and `RunsScreen` with one run to prove `.run-open` is on the rendered button. Add all four to the *never a bare 44px literal* loop.

- [ ] **Step 8: Run the suite and the gates**

Run: `cd pwa && npx vitest run && npx tsc --noEmit && node design/contrast-check.mjs` (foreground)
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add pwa/src/fleet/runWords.ts pwa/src/screens/RunsScreen.tsx pwa/src/app.tsx \
        pwa/src/screens/FleetScreen.tsx pwa/src/fleet/fleet.css \
        pwa/test/runs-screen.test.tsx pwa/test/app.test.tsx pwa/test/tap-targets.test.tsx pwa/test/fleet-css.test.ts
git commit -m "feat(pwa): /runs — the board, its own status words, and a door that is always there"
```

---

### Task 6: the session's own mail, one row above the plan

**Files:**
- Create: `pwa/src/session/MailStrip.tsx`
- Modify: `pwa/src/stores/session.ts` (`SessionSnapshot`, `applySessionMsg` `:116-177`)
- Modify: `pwa/src/screens/SessionScreen.tsx` (`:262-264`)
- Modify: `pwa/src/session/chat.css`
- Create: `pwa/test/mail-strip.test.tsx`
- Modify: `pwa/test/tap-targets.test.tsx`

**Interfaces:**
- Consumes: `MailItem` and the `{type:'mail'}` session frame (PR I interfaces 1 and 4).
- Produces: `MailStrip({ mail }: { mail: MailItem[] })`, `summarizeMail(mail)`.

**Scope, stated so it is not quietly exceeded:** *"A full in-transcript mail `ChatItem` is deferred to Build 4's transcript surface — one build owns the conversation model."* **This task adds no `ChatItem` kind, touches no `ChatList`, and adds no local divider.** The local-divider route is doubly refused: `stores/session.ts:121-124` keeps them across a backlog **only** if every event in the store is already one, so a mail thread rendered that way vanishes on the next reconnect.

**Placement:** above `TaskStrip`, which stays the composer's immediate neighbour. TaskStrip's own comment defends that position — *"where the terminal puts it: between the conversation and the prompt you are about to type into"* — and mail is ambient state about the session, so it stacks above the plan rather than displacing it.

- [ ] **Step 1: Write the failing tests**

Create `pwa/test/mail-strip.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import type { MailItem } from '../../shared/api';
import { MailStrip, summarizeMail } from '../src/session/MailStrip';

afterEach(cleanup);

const m = (over: Partial<MailItem> = {}): MailItem => ({
  id: 'm-1', at: Date.now() - 30_000, fromId: 'coordinator', toId: 'ccrc-pwa-clear-cove',
  runId: 'run-3', kind: 'question', subject: 'rebase before you start?',
  body: 'Wave 3 lands on main; rebase ws/clear-cove first.',
  artifacts: [], delivery: 'delivered', rejectCode: null, ...over,
});

describe('the session mail strip', () => {
  it('renders NOTHING when there is no outstanding mail', () => {
    // TaskStrip's rule, and the reason: an ordinary conversation must not pay a
    // row for a feature it is not using.
    const { container } = render(<MailStrip mail={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('collapses to one headline plus a count', () => {
    render(<MailStrip mail={[m(), m({ id: 'm-2', subject: 'findings from the review lens' })]} />);
    expect(screen.getByText('findings from the review lens')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText(/rebase ws\/clear-cove first/)).not.toBeInTheDocument();
  });

  it('expands to the rows, with sender, kind and artifact paths', () => {
    render(<MailStrip mail={[m({ artifacts: ['docs/superpowers/programs/build4.md'] })]} />);
    fireEvent.click(screen.getByRole('button', { name: /mail/i }));
    expect(screen.getByText('coordinator')).toBeInTheDocument();
    expect(screen.getByText('question')).toBeInTheDocument();
    expect(screen.getByText('docs/superpowers/programs/build4.md')).toBeInTheDocument();
  });

  it('offers no way to answer — composing mail from the PWA is a stated non-goal', () => {
    render(<MailStrip mail={[m()]} />);
    fireEvent.click(screen.getByRole('button', { name: /mail/i }));
    expect(screen.queryByRole('textbox')).toBeNull();
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-label') ?? b.textContent ?? '').not.toMatch(/reply|answer|send/i);
    }
  });

  it('summarizes by kind, dropping the zero clauses', () => {
    expect(summarizeMail([m({ kind: 'question' }), m({ id: '2', kind: 'finding' }), m({ id: '3', kind: 'finding' })]))
      .toBe('1 question · 2 findings');
    expect(summarizeMail([])).toBe('');
  });
});

describe('the session store takes the mail frame', () => {
  it('replaces the list, and an old client still shrugs at an unknown frame', () => {
    // applySessionMsg is a pure reducer with `msg satisfies never` in its
    // default arm — compile-time exhaustiveness here, shrug-not-corrupt for a
    // build that predates the frame.
    const s0 = { events: [], uuid: null, offset: 0, tasks: [], mail: [] } as never;
    expect(applySessionMsg(s0, { type: 'mail', mail: [m()] }).mail).toHaveLength(1);
  });
});
```

(the last describe uses the file's existing `applySessionMsg` harness in `pwa/test/tasks.test.tsx` / `chat.test.tsx` — **copy that file's snapshot factory rather than the sketch above**.)

- [ ] **Step 2: Run and watch it fail**

Run: `cd pwa && npx vitest run test/mail-strip.test.tsx` → FAIL.

- [ ] **Step 3: The store slot**

In `pwa/src/stores/session.ts`, add `mail: MailItem[]` to `SessionSnapshot` (initial `[]`) and one arm beside `case 'tasks'`:

```ts
    // Outstanding mail for THIS session — queued or delivered, never acked or
    // rejected (the server filters). Replaced wholesale like `tasks`, because
    // the frame is a statement about the present and these streams never queue
    // (lib/ws.ts:12-17).
    case 'mail':
      return { ...s, mail: msg.mail };
```

The `default` arm is untouched: `msg satisfies never` now proves this switch handles the new variant, which is precisely the compile-time reminder the union's own comment promises.

- [ ] **Step 4: The strip**

Create `pwa/src/session/MailStrip.tsx`:

```tsx
// Outstanding mail for THIS session, in the TaskStrip idiom: collapsed to one
// headline by default, expanding to rows, and rendering nothing at all when
// there is none — an ordinary conversation must not pay a row for a feature it
// is not using.
//
// It sits ABOVE TaskStrip, which keeps the composer's immediate neighbour: the
// TUI puts the plan directly above the prompt and TaskStrip's own comment
// defends that placement. Mail is ambient state about the session, so it stacks
// on top of the plan rather than displacing it.
//
// NO transcript arm. A mail ChatItem is Build 4's, by the spec — one build owns
// the conversation model — and the local-divider shortcut is refused twice
// over: stores/session.ts:121-124 keeps dividers across a backlog only when
// every event in the store is already one, so a thread rendered that way
// disappears on the next reconnect.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { MailItem } from '../../../shared/api';
import './chat.css';

const PLURAL: Record<MailItem['kind'], [string, string]> = {
  finding: ['finding', 'findings'], question: ['question', 'questions'],
  answer: ['answer', 'answers'], status: ['status', 'statuses'],
  artifact: ['artifact', 'artifacts'], unknown: ['message', 'messages'],
};

/** "1 question · 2 findings" — the counts that matter, zero-count clauses
 *  dropped rather than printed as "0". `summarize`'s rule, one file over. */
export function summarizeMail(mail: readonly MailItem[]): string {
  const parts: string[] = [];
  for (const kind of Object.keys(PLURAL) as MailItem['kind'][]) {
    const n = mail.filter((x) => x.kind === kind).length;
    if (n > 0) parts.push(`${n} ${PLURAL[kind][n === 1 ? 0 : 1]}`);
  }
  return parts.join(' · ');
}

export function MailStrip({ mail }: { mail: MailItem[] }): ReactNode {
  const [open, setOpen] = useState(false);
  if (mail.length === 0) return null;

  const newest = [...mail].sort((a, b) => b.at - a.at)[0]!;

  return (
    <section className={open ? 'mail-strip mail-strip--open' : 'mail-strip'} aria-label="Mail">
      <button type="button" className="mail-strip-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="mail-strip-mark" aria-hidden="true">✉</span>
        <span className="mail-strip-headline">{newest.subject}</span>
        <span className="mail-strip-count">{mail.length}</span>
        <span className="mail-strip-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>

      <p className="mail-strip-summary">{summarizeMail(mail)}</p>

      {open && (
        <ol className="mail-strip-rows">
          {mail.map((item) => (
            <li key={item.id} className="mail-strip-row">
              <span className="mail-strip-from">{item.fromId}</span>
              <span className="mail-strip-kind">{item.kind}</span>
              <span className="mail-strip-subject">{item.subject}</span>
              <p className="mail-strip-body">{item.body}</p>
              {/* Artifacts are PATHS, never payloads (spec §1) — so they render
                  as paths, in the machine's voice, and nothing here fetches
                  one. */}
              {item.artifacts.length > 0 && (
                <ul className="mail-strip-artifacts">
                  {item.artifacts.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

**No reply control, deliberately.** Spec §10 lists PWA mail composition as a non-goal — *"humans already have the composer"* — and the test above pins the absence rather than trusting the omission.

- [ ] **Step 5: Mount it**

`pwa/src/screens/SessionScreen.tsx`, immediately above the existing `<TaskStrip tasks={tasks} />` (`:262-264`):

```tsx
      {/* Above the plan, which stays the composer's neighbour. */}
      <MailStrip mail={mail} />
```

with `const mail = useStore((s) => s.mail);` beside the existing `tasks` selector.

- [ ] **Step 6: The stylesheet**

Append to `pwa/src/session/chat.css`, mirroring `.task-strip`'s tokens exactly (same well, same radius, same head height) so the two strips read as one stack rather than two designs — and `min-height: var(--tap-min)` on `.mail-strip-head`.

- [ ] **Step 7: Run the suite and the gates**

Run: `cd pwa && npx vitest run && npx tsc --noEmit && node design/contrast-check.mjs` (foreground)
Expected: PASS. Watch `chat.test.tsx` and `tasks.test.tsx`: they render `SessionScreen` and now have one more element in the stack above the composer.

- [ ] **Step 8: Commit**

```bash
git add pwa/src/session/MailStrip.tsx pwa/src/stores/session.ts pwa/src/screens/SessionScreen.tsx \
        pwa/src/session/chat.css pwa/test/mail-strip.test.tsx pwa/test/tap-targets.test.tsx
git commit -m "feat(pwa): this session's outstanding mail, one row above the plan"
```

---

### Task 7: the drill that proves the ledger is enough, and the record an operator reads

**Files:**
- Create: `server/test/reconstruction-drill.test.ts`
- Create: `server/test/fixtures/reconstruct/ledger.md`
- Create: `server/test/fixtures/reconstruct/registry/*` (four small files)
- Create: `server/test/fixtures/reconstruct/prhistory.jsonl`
- Modify: `server/test/single-definition.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `RunSummary` (PR I interface 1) as the shape the drill reconstructs *to*; nothing else. **The drill imports no production module** and ships no parser (**D-4**).

**What the drill actually proves.** Spec §2: *"If the DB is lost, a program is reconstructible from `docs/superpowers/programs/<slug>.md` + the registry + `.prhistory` — and a test proves the reconstruction path for a representative program."* The claim under test is about the **artifacts**, not about any code: that between those three files, everything a run row asserted is still recoverable by a human (or a fresh session) following a written procedure. So the procedure is written **in the test**, run against fixtures, and compared to the run rows the lost DB would have held — and the fields it genuinely cannot recover are asserted **by name**, so the drill can never be quoted as a completeness claim it does not make.

- [ ] **Step 1: Write the fixtures**

`server/test/fixtures/reconstruct/ledger.md` — a filled `TEMPLATE.md` for a three-wave program:

```markdown
# Program: build4-transcript-surface
Spec: docs/superpowers/specs/2026-08-09-build4-transcript-design.md   Plan: docs/superpowers/plans/2026-08-10-build4-transcript.md   Workspace: ccrc-pwa-clear-cove
## Waves
| # | scope | PRs | state |
| 1 | the event model and the store slot | #577 | merged |
| 2 | ChatItem arms and the virtuoso list | #583 | merged |
| 3 | mail in the transcript, and the jump-to-latest pill | — | in flight |
## Decisions & deviations
- Wave 2 kept `ChatListInner` as the jsdom renderer rather than mocking virtuoso a second time.
## Carried constraints
- The settled label must stay ONE text node (header.test.tsx reads it with getAllByText).
## Next-wave brief
Rebase `ws/clear-cove` onto main first. Wave 3 adds the mail ChatItem arm; the strip above the composer already ships and must keep working unchanged.
```

`server/test/fixtures/reconstruct/registry/` — the four registry fields a workspace carries, one file each, exactly as `_reg_set` writes them (`ccd:108`): `ccrc-pwa-clear-cove.hold` = `program:build4-transcript-surface wave:3/3`, `.workspace` = `clear-cove`, `.branch` = `ws/clear-cove`, `.project` = `ccrc-pwa`.

`server/test/fixtures/reconstruct/prhistory.jsonl`:

```
{"pr": 577, "branch": "ws/clear-cove", "phase": "merged", "recordedAt": 1754200000}
{"pr": 583, "branch": "ws/clear-cove", "phase": "merged", "recordedAt": 1754400000}
```

- [ ] **Step 2: Write the drill**

Create `server/test/reconstruction-drill.test.ts`:

```ts
// The disaster-recovery drill (spec §2).
//
// coord.db is the first artifact in this system whose loss is not free, and the
// stated mitigation is that it is not the only record: the program ledger
// (markdown, committed), the registry (on the fleet host) and `.prhistory`
// (append-only, on the fleet host) between them still say what happened. This
// test is the proof, and it is a test about the ARTIFACTS, not about any code:
//
//   * the reconstruction procedure below lives HERE and ships nowhere. The
//     ledger is "for humans and parsed by nothing" (spec §7), and
//     single-definition.test.ts now enforces that no file under server/src
//     mentions docs/superpowers/programs at all.
//   * what it CANNOT recover is asserted by name, so nobody can read this as a
//     claim that the DB is redundant.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fx = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/reconstruct');

interface Reconstructed {
  program: string; sessionId: string; workspace: string; branch: string; project: string;
  currentWave: number; waves: number;
  perWave: { wave: number; prs: number[]; state: string }[];
  confidence: 'hold-corroborated' | 'ledger-only';
}

/** The written procedure, executed. Read it as prose: this is what a human, or
 *  a fresh session, does with the three artifacts and no database. */
function reconstruct(dir: string): Reconstructed {
  const ledger = readFileSync(path.join(dir, 'ledger.md'), 'utf8');

  // 1. The program's identity and its workspace come off the ledger's header —
  //    the two facts the file exists to carry across sessions.
  const program = /^# Program: (\S+)/m.exec(ledger)![1]!;
  const sessionId = /Workspace: (\S+)/.exec(ledger)![1]!;

  // 2. The wave table gives scope, PRs and state per wave. `—` means no PR was
  //    opened for that wave yet; it is not zero and it is not unknown.
  const perWave = [...ledger.matchAll(/^\| (\d+) \| [^|]+\| ([^|]+)\| ([^|]+)\|/gm)].map((m) => ({
    wave: Number(m[1]),
    prs: [...m[2]!.matchAll(/#(\d+)/g)].map((p) => Number(p[1])),
    state: m[3]!.trim(),
  }));

  // 3. The registry says where the work physically is, and — while the hold is
  //    still on — which wave the program had reached. The hold reason is
  //    display-only by contract (registry.ts:27); reading it HERE is a
  //    disaster-recovery act by a human, not a parser in the running system,
  //    and it is corroborated against the ledger below rather than trusted.
  const reg = (field: string): string | null => {
    const f = path.join(dir, 'registry', `${sessionId}.${field}`);
    return readdirSync(path.join(dir, 'registry')).includes(path.basename(f))
      ? readFileSync(f, 'utf8').trim() : null;
  };
  const hold = reg('hold');
  const m = hold === null ? null : /wave:(\d+)\/(\d+)/.exec(hold);

  // 4. `.prhistory` is the PR lineage the archive manifest would otherwise
  //    carry — the corroboration for the ledger's PR column.
  const prs = readFileSync(path.join(dir, 'prhistory.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as { pr: number });
  const ledgerPrs = perWave.flatMap((w) => w.prs);
  for (const { pr } of prs) {
    expect(ledgerPrs, `#${pr} is in .prhistory but not in the ledger`).toContain(pr);
  }

  return {
    program, sessionId,
    workspace: reg('workspace')!, branch: reg('branch')!, project: reg('project')!,
    currentWave: m ? Number(m[1]) : perWave.filter((w) => w.state === 'merged').length + 1,
    waves: m ? Number(m[2]) : perWave.length,
    perWave,
    confidence: m ? 'hold-corroborated' : 'ledger-only',
  };
}

describe('the reconstruction drill', () => {
  it('recovers the program a lost coord.db was holding', () => {
    const r = reconstruct(fx);
    expect(r).toMatchObject({
      program: 'build4-transcript-surface',
      sessionId: 'ccrc-pwa-clear-cove',
      workspace: 'clear-cove',
      branch: 'ws/clear-cove',
      project: 'ccrc-pwa',
      currentWave: 3,
      waves: 3,
      confidence: 'hold-corroborated',
    });
    expect(r.perWave).toEqual([
      { wave: 1, prs: [577], state: 'merged' },
      { wave: 2, prs: [583], state: 'merged' },
      { wave: 3, prs: [], state: 'in flight' },
    ]);
  });

  it('still recovers the program with the hold released, and SAYS the confidence dropped', () => {
    // The final-merge state: the coordinator released, the sweep archived, the
    // DB is gone. The ledger alone still answers, and the drill must not
    // pretend the corroboration it lost was never there.
    const dir = copyFixtureWithout(fx, 'registry/ccrc-pwa-clear-cove.hold');
    const r = reconstruct(dir);
    expect(r.currentWave).toBe(3);
    expect(r.confidence).toBe('ledger-only');
  });

  it('names exactly what CANNOT be reconstructed, so this is never read as "the DB is redundant"', () => {
    // These are the RunSummary/work-item fields no artifact carries. Every one
    // of them is a timing or a granularity the ledger deliberately does not
    // record — which is the case for having a database, stated as a test rather
    // than as a paragraph nobody re-reads.
    const UNRECOVERABLE = [
      'dispatchedAt', 'closedAt',        // wall-clock instants; the ledger keeps order, not time
      'work item ids and their blockedBy DAG',
      'per-item doneFingerprint',
      'mail bodies and their delivery/ack state',
      'coordinator caps counters',
    ] as const;
    const ledger = readFileSync(path.join(fx, 'ledger.md'), 'utf8');
    for (const field of UNRECOVERABLE) {
      expect(ledger.toLowerCase()).not.toContain(field.toLowerCase().split(' ')[0]!);
    }
    expect(UNRECOVERABLE.length).toBe(6);
  });

  it('refuses to invent a program when the ledger is missing', () => {
    // A DB loss with no committed ledger is an unrecoverable program, and the
    // honest answer is a loud failure — the same polarity as the migration
    // rule (spec §2: refuse to start, never start empty).
    expect(() => reconstruct(copyFixtureWithout(fx, 'ledger.md'))).toThrow();
  });
});
```

(`copyFixtureWithout` is four lines over `mkTmp` + `cpSync` + `rmSync`; write it at the top of the file.)

- [ ] **Step 3: Make "parsed by nothing" a mechanism**

Append to `server/test/single-definition.test.ts`:

```ts
describe('the program ledger is parsed by nothing', () => {
  // Spec §7, and the reason the reconstruction drill's parser lives in a test:
  // the moment the running system reads this file, the file stops being prose
  // for humans and becomes a format with a compatibility surface.
  it('no shipped source mentions the program ledger directory', () => {
    const holders = ALL
      .filter((f) => !rel(f).startsWith('server/test/'))
      .filter((f) => readFileSync(f, 'utf8').includes('docs/superpowers/programs'))
      .map(rel);
    expect(holders).toEqual([]);
  });
});
```

- [ ] **Step 4: The README**

Add a `## Fleet coordination — programs, runs and mail` section **after** the `### Workspace holds & programs` subsection and **before** `## Attention, notifications and answering`. A `##` heading there is safe: `readme-holds.test.ts` slices from `### Workspace holds & programs` to the next `\n## `, so the holds prose it asserts on is unchanged — a `###` there would be swallowed into that slice instead.

````markdown
## Fleet coordination — programs, runs and mail

A **program** is a long-horizon effort with a slug and a markdown ledger
(`docs/superpowers/programs/<slug>.md`, in the project's own repo, committed,
and parsed by nothing). A **run** is one wave of it in one workspace. A
**coordinator** is an ordinary fleet session running the `ccrc-coordinator`
skill, placed by `_ws_least_loaded` like any other session.

**The coordinator acts through the server's HTTP API, never raw ccd.** That is
a contract in its skill, not a mechanism: every session on the fleet host runs
as one UNIX user and can already run any verb. What the contract buys is that
every act is *recorded* on the run, caps are *enforced* at one place, and the
PWA sees all of it. The skill's eight contract clauses are pinned by
`server/test/coordinator-skill.test.ts`, so softening one is a red suite.

**`ws-reap` stays human-only by convention plus a speed bump, and that is
stated rather than dressed up.** The skill excludes reap; the coordinator holds
every workspace it owns, so any reap needs a deliberate release first; and reap
consent stays the PWA's ceremony. Nothing here makes reap mechanically
impossible for a process with a shell.

**Pause is a file.** `touch ~/.cc-sessions/coordinator-paused` and the next
dispatch refuses; `rm` it to resume. It is read before every dispatch, shown as
a banner, and the coordinator has no route, verb or instruction that would let
it remove the file itself.

**The skill ships to all four account homes.** Skills resolve per
`CLAUDE_CONFIG_DIR`, and a session's account drifts on swap — so
`ccd/install-coordinator-skill.sh` installs into `~/.claude`,
`~/.claude-personal`, `~/.claude-corp` and `~/.claude-gpt` on every agent
deploy, idempotently, backing up anything it replaces. That lane is what makes
"place the coordinator like any other session" safe.

**The box token.** It authenticates *the box* — the honest unit, since every
session on it shares one uid. Mint it once into the single local file
`deploy/ccrc-mail.token` (gitignored; see `deploy/ccrc-mail.token.example`), and
`deploy.sh` ships that one file to **both** boxes: `~/.cc-secrets/ccrc-mail.token`
on the fleet host, which `notify.sh` and every session present as
`x-ccrc-mail-token`, and `~/.ccrc/mail.token` on the server box, read at boot.
Two copies of one secret, equal by construction rather than by someone
remembering. Per-session identity rides as attribution (`fromId`/`fromUuid`,
checked against the registry's current uuid): freshness, not
forgery-proofness.

**Three surfaces.** `/runs` is the board — runs grouped by program, with their
own status words (a run is a lifecycle position, not an attention state, so it
borrows none of the bucket vocabulary and nothing on it glows). `/mail` is the
durable feed, reached from the ✉ beside the bell. Every session's own
outstanding mail sits above the composer, one row above the task strip.

**Records land in the feed whether or not you were watching.** Only the *push*
is presence-gated: a notification for a session you already have open is noise,
but a record of an agent-to-agent message is a fact about the fleet, and it is
kept either way.

**If the database is lost**, a program is reconstructible from its ledger, the
registry and `.prhistory` — `server/test/reconstruction-drill.test.ts` is that
procedure, executed against fixtures, and it names the fields no artifact
carries (wall-clock dispatch/close instants, work-item ids and their
`blockedBy`, per-item fingerprints, mail bodies and delivery state, caps
counters) rather than implying there are none.

### Dogfood: Build 4 is the first coordinated program

By decision (spec §9), the first program run through the coordinator is Build 4,
the transcript surface. Before starting it:

1. The token is on both boxes: `ls -l ~/.cc-secrets/ccrc-mail.token` on the
   fleet host and `~/.ccrc/mail.token` on the server, each `-rw-------`. Do not
   `cat` either one.
2. `ls ~/.claude*/skills/ccrc-coordinator/SKILL.md` lists four paths.
3. `~/.cc-sessions/coordinator-paused` does **not** exist.
4. The ledger exists and is committed: copy `docs/superpowers/programs/TEMPLATE.md`
   to `docs/superpowers/programs/build4-transcript-surface.md`, fill the header
   and wave 1, commit.
5. Open the run, then dispatch. Watch `/runs`; read `/mail`.

Success is a program that completes with human pauses only at review points,
and an audit trail that reads true.
````

Then two corrections the spec requires (§0, fact 1):

- `README.md:20` — if PR I has not already done it, replace *"No database"* with a sentence naming `~/.ccrc/coord.db` and pointing at the section above. (Interface 11.)
- `README.md:443-445` — *"this is what's deployed today"* is attached to `CCRC_FLEET=local` and is **false**: `/api/fleet/health` answers `{"mode":"remote"}`. Move the sentence to the remote paragraph.

- [ ] **Step 5: Run the README's own guard and the new suites**

Run: `cd server && npx vitest run test/readme-holds.test.ts test/reconstruction-drill.test.ts test/single-definition.test.ts`
Expected: PASS. If `readme-holds` fails, the new section landed **inside** the holds slice — move it after, as Step 4 says.

- [ ] **Step 6: Commit**

```bash
git add README.md server/test/reconstruction-drill.test.ts server/test/fixtures/reconstruct \
        server/test/single-definition.test.ts
git commit -m "docs: what a program is now, and the drill that proves the ledger is enough"
```

---

### Task 8: gates, mutants and the live proof

- [ ] **Step 1: Full suites, all three packages, foreground**

Run: `cd agent && npx vitest run && cd ../server && npx vitest run && cd ../pwa && npx vitest run` (`timeout: 600000`)
Expected: PASS. **Record the real printed counts**, package by package, against the pre-branch baseline.

Note carried from the sibling lane: on the fleet host the `server` suite exercises ccd's disk-floor check through the fixture-HOME harness and needs ≥10 G free where fixture homes land, or `CCD_DISK_FLOOR_GB=1` as the sanctioned override. That is not a failure of this diff.

- [ ] **Step 2: Typecheck the shipped builds**

Run: `cd server && npx tsc --noEmit && cd ../agent && npx tsc --noEmit && cd ../pwa && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: The design gates, as gates**

Run: `cd pwa && node design/contrast-check.mjs`
Expected: PASS, and every new rule appears in the measured census. **Nothing new is registered in `GROUNDS`/`INHERITED_GROUNDS`/`SELF_GROUNDED_EXEMPT` by this branch** — if a rule cannot be measured, make it self-grounded instead.

**Amendment (Task 8 fix round 1, 2026-08-11): the census half was never actually checked — measured now.** The
original execution verified only that `pwa/design/` had an empty diff against `a6b75757` (true, and still the right
basis for "nothing new registered") and, on that basis alone, called the whole step "trivial (no CSS changed by this
branch)" — false: `fleet.css` +104, `chat.css` +115. Nobody ran `contrast-check.mjs --uncovered` and looked at what
this branch actually added. Measured: pre-branch (`a6b75757`) is `ALL 300 PASS`, 207 uncovered; the tree as handed
over was `ALL 310 PASS` (the five new self-grounded rules — `.mail-badge-count`, `.mail-row`, `.runs-group-head`,
`.run-row`, `.mail-strip-count` — × 2 themes), 237 uncovered, of which exactly 30 are this branch's own (`comm -13`
against the pre-branch list).

Applied the cheap remedy the plan itself points at: `contrast-check.mjs`'s route 2b (named-ancestor descendants,
`design/audit.mjs:865-909`) measures a colour-only rule whose selector NAMES a self-grounded ancestor, with no
registry entry. Of the 30, **15 are genuine descendants of an already self-grounded row** and were respelled to say
so — no visual change, the descendant combinator matches at any depth and every one of these classes is already
rendered inside the row in the DOM: `.mail-row .mail-kind`, `.mail-row .mail-when`, `.mail-row .mail-body`
(`fleet.css`, under `.mail-row`); `.run-row .run-open`, `.run-row .run-glyph`, `.run-row .run-state`, `.run-row
.run-tally, .run-row .run-when` (`fleet.css`, under `.run-row`); and all eight `.mail-strip-*` rules in `chat.css`,
scoped under `.mail-strip` after giving that rule a `color` alongside its existing `background` — it painted no
direct text of its own, so this is audit-only, not a rendering change, and makes `.mail-strip` genuinely
self-grounded (route 1) rather than inventing a fake ground. `pwa/test/tap-targets.test.tsx` and
`pwa/test/fleet-css.test.ts` reference several of these selectors by exact text (`ruleIn`) and were updated to
match; the full `pwa` suite (53 files / 1299 tests) stays green. Result: **`ALL 342 PASS`**, 222 uncovered (207
pre-branch + 15 of this branch's own left standing).

The remaining **15 are accepted, explicitly, not overlooked**: `.mail-badge`(+2 variants), `.mail-back`(+1),
`.mail-title`, `.mail-note`, `.mail-dropped`, `.mail-empty`, `.fleet-runs-row`, `.runs-back`(+1), `.runs-title`,
`.runs-empty`, `.runs-wave` — header buttons, headings, empty-state text and a standalone door row that render
directly on the screen/page ground, not inside any self-grounded card. Respelling these under a fabricated ancestor
would be a false claim about the DOM, not a measurement; giving each a real background would be a visual redesign
outside this fix round's scope. They sit in the same `uncovered` bucket roughly 200 pre-existing rules across the
app already do (icon buttons, section headings, empty states) — a bucket this auditor has always been honest about
being unable to recover DOM-only ground for, printed as a number rather than silently assumed clean. Nothing new is
registered in `GROUNDS`/`INHERITED_GROUNDS`/`SELF_GROUNDED_EXEMPT` either way — confirmed, `pwa/design/` stays at an
empty diff against `a6b75757` throughout this fix.

- [ ] **Step 4: Lint the shell**

Run: `bash -n ccd/install-coordinator-skill.sh deploy/deploy.sh && shellcheck -S error ccd/install-coordinator-skill.sh deploy/deploy.sh || true`

- [ ] **Step 5: Mutation sweep**

One literal mutant per added construct, full suite per mutant, sha256-verified restore between.

| mutant | must fail |
|---|---|
| SKILL.md: soften clause 3 (`never reaps` → `avoids reaping`) | `carries all eight clauses verbatim` |
| SKILL.md: mention `ws-reap` once more, anywhere | `names the three destructive verbs ONLY inside the clause that forbids them` |
| SKILL.md: rename a route (`/api/runs/:id/advance` → `/api/runs/:id/close`) | `names no route the server does not register` |
| `references/mail-envelope.md`: change one character of the worked envelope | `quotes an envelope byte-identical to…` |
| `references/ledger-template.md`: drop one line | `ships the ledger template byte-identical…` |
| installer: delete the `diff -r -q` converged-skip | `re-running converges` (inode) |
| installer: `homes=(…four…)` → three entries | `installs the skill into every home it is given` |
| installer: drop the backup `cp -a` | `replaces a stale install and backs the old one up first` |
| installer: `rc=1` → `continue` (swallow the failure) | `reports a failed home in the exit status` |
| installer: remove the `[[ -f "$SRC/SKILL.md" ]]` refusal | `refuses the whole run when the source has no SKILL.md` |
| `deploy.sh`: drop `--delete` from the skill rsync | `rsyncs the skill with --delete` |
| `deploy.sh`: move the skill install ABOVE the hook installer | `installs the skill in the agent arm, after the hook installer` |
| `seen.ts`: delete `if (id.includes(':')) continue;` | `prune never deletes a namespaced key` |
| `seen.ts`: inline the comparison back into `isUnseen` | `isUnseen is a caller of isUnseenAt` |
| `feed.ts`: unknown kind → `'mail'` instead of `'unknown'` | `lands a kind from a NEWER build on 'unknown'` |
| `feed.ts`: drop the `dropped` counter (return 0 always) | `says how many records it could not read at all` |
| `feed.ts`: `mergeBySeq` slices from the NEW end | `caps the list from the OLD end` |
| `MailBadge`: render `null` when `unread === 0` | `is always rendered — with a count, and without one` |
| `MailBadge`: put the accessible name at the capped number | `caps the printed count…` (the 412 assertion) |
| `app.tsx`: drop `mail` (then `runs`) from the `data-view` OR | the `/mail` and `/runs` cases in `app.test.tsx` |
| `MailScreen`: skip the mount ack | `marks unread rows before the ack and none after it` |
| `MailScreen`: hide `kind === 'unknown'` rows | `renders a kind from a newer build rather than hiding the record` |
| `RunsScreen`: `role="group"` → `<section aria-label>` | `the group is a role=group — not a landmark` |
| `RunsScreen`: always render `.run-open` (even with a null session) | `renders an INERT row when there is no session to open` |
| `RunsScreen`: poll `GET /api/runs` on an interval | `never asks REST when the frame already answered` |
| `runWords.ts`: delete the `unknown` entry, default to `planned` | `lands a state from a newer build on 'unknown'` |
| `fleet.css`: add `box-shadow: var(--glow-busy)` to `.run-row` | `no run rule glows, breathes or animates` |
| `MailStrip`: render an empty `<section>` for zero mail | `renders NOTHING when there is no outstanding mail` |
| `MailStrip`: add a reply button | `offers no way to answer` |
| `session.ts`: drop the `case 'mail'` arm | `the session store takes the mail frame` **and** `tsc` (`satisfies never`) |
| drill fixture: remove `#583` from the ledger's wave table | `#583 is in .prhistory but not in the ledger` |
| drill: return `'hold-corroborated'` unconditionally | `still recovers … and SAYS the confidence dropped` |
| `single-definition`: add `docs/superpowers/programs` to a `server/src` file | `no shipped source mentions the program ledger directory` |

A survivor is a finding, not a pass.

**Amendment (Task 8 execution, 2026-08-11): all 34 constructs the table above names were actually re-measured** —
edited the real construct, ran the FULL relevant suite (`server`: 92 files/1953 tests; `pwa`: 53 files/1298-1299
tests), confirmed the named test (or an equally on-point one, where the tree had moved past the table's literal
wording — nine contract clauses and five install homes ship today, not the table's eight/four) went red, then
restored via `git checkout --` and diffed clean. No row was credited by inspection alone. Two adaptations and two
genuine survivors, closed rather than left as gaps:

- The table's clause-3/route/home-count rows were written against the plan's pre-reconciliation shapes (8 clauses,
  `claimed`, four homes). The tree today carries Task 7's nine clauses (`claimed-by-another`, clause 9's `/clear`
  rule) and the roster-derived five-entry default `homes` fallback (`.claude-dev0` now `hooksAble:true`). Each
  mutant was re-aimed at the real construct — soften clause 3, mis-route `/api/runs/:id/advnace`, drop
  `.claude-dev0` from the default array — and killed by the CURRENT test with the CURRENT wording
  (`coordinator-skill.test.ts`'s nine-clause array; `wrapper-roster-fixture.test.ts` and
  `install-coordinator-skill.test.ts`'s "touches exactly the roster's hooksAble config dirs" case).
- `feed.ts: unknown kind → 'mail'`: `feed.ts` has no kind-mapping logic of its own — it delegates to the
  pre-existing `reviveNotifyEvent`/`isNotifyKind` (`shared/api.ts`), unchanged by this branch. The mutant was
  applied to that shared fallback instead (`isNotifyKind(kindRaw) ? kindRaw : 'mail'`) to prove `feed.test.ts`'s
  new "lands a kind from a NEWER build on `unknown`" case actually discriminates a fault in the dependency it
  relies on — which it does (and so does the pre-existing `notifymark.test.ts`, confirming no regression in shared
  coverage either).

**Survivor 1 — `RunsScreen: poll GET /api/runs on an interval`.** Adding a real `setInterval` re-fetch inside the
cold-read effect left the FULL `pwa` suite green: `runs-screen.test.tsx`'s only related assertion
(`toHaveBeenCalledTimes(1)`) checks the call count at the point `render()` returns, before any timer has fired, and
nothing in the file drives fake time forward. Closed with a new case, `'never asks REST on an interval — one cold
read per mount, never a poll'`, using `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(5 * 60_000)` (which also
drains the promise microtask queue between ticks) and counting `loadRuns` calls directly — a bare
`setInterval`-was-never-called spy was tried first and produces a FALSE positive against the real component,
because `useNow(30_000)` legitimately runs its own unrelated interval for the relative-time readout. The new test
passes on the shipped code and fails (11 calls, not 1) against the interval mutant. `pwa/test/runs-screen.test.tsx`.

**Survivor 2 — `deploy.sh: move the skill install ABOVE the hook installer`.** Swapping the two invocation blocks
left the FULL `server` suite green: `install-coordinator-skill.test.ts`'s ordering check was a bare
`agentArm.indexOf('install-session-hooks.sh')` vs `indexOf('install-coordinator-skill.sh')`, and the
coordinator-skill block's OWN explanatory comment — *"(ccd, session-hook.sh, install-session-hooks.sh, and now
this)"* — mentions the string `install-session-hooks.sh` in prose, earlier in the text than either block's actual
code once the code was moved. The bare substring search found the comment, not the invocation. Closed by anchoring
both `indexOf` calls on the real RUN lines (`bash ~/.cc-sessions/install-session-hooks.sh` /
`bash ~/.cc-sessions/install-coordinator-skill.sh`), which the comment does not contain. The fixed assertion passes
on the shipped `deploy.sh` and fails (3412 vs 2894) against the swap mutant. `server/test/install-coordinator-skill.test.ts`.

**Amendment (Task 8 fix round 1, 2026-08-11): the CSS-mutant deviation above was justified by a false inference, and
by a flat factual error repeated twice more — corrected here with a measurement, not a re-run.** The original
justification read: "vitest runs with `css: false` … so no other test file parses computed style and a
stylesheet-only edit cannot affect any other suite's outcome." The first clause is true; the second does not follow
and is false. Eleven `pwa` test files read `fleet.css`/`chat.css` as TEXT (`ruleIn`/`declValue`/`stripComments`,
`test/cssRule.ts`), not as computed style — `css: false` says nothing about them — and `tap-targets.test.tsx`
specifically scrapes `min-height` off the sheet and bans a bare `44px` literal, so a stylesheet-only edit absolutely
can change a non-CSS-gate suite's outcome. The same false premise appeared twice more, as a flat factual error: the
implementer's report called Step 3 "trivial (no CSS changed by this branch)" and the commit message said "no CSS
changed on this branch" — `git diff --stat a6b75757..HEAD -- '*.css'` is `fleet.css +104, chat.css +115`, 219 lines.
What is actually unchanged is `pwa/design/` (GROUNDS/INHERITED_GROUNDS/SELF_GROUNDED_EXEMPT), which is the correct,
narrower basis for "nothing new registered" — the conclusion held, the reason given did not.

The measurement risk is closed, not inferred: the glow mutant (`box-shadow: var(--glow-busy)` on `.run-row`) was
re-applied after this round's own Step 3 fix (below) and run against the FULL `pwa` suite — `1 failed | 1298 passed
(1299)`, the single failure being `fleet-css.test.ts > no run rule glows, breathes or animates` — then restored,
tree clean. So the sweep table's own deviation note stands corrected: the targeted-file substitution for this one
mutant is still the practice going forward (`ruleIn`/`declValue`-based suites are enumerable and stable, and nothing
found breaks that isn't already named above), but it is a documented, now-measured lower-risk substitution, not one
resting on the false "no other suite can see CSS" claim — and "no CSS changed" was never true of this branch.

**Amendment (Task 8 fix round 1, 2026-08-11): the sweep above measured the plan's stale 34-row table, not the whole
diff — the post-plan constructs get their own pass here, one mutant each, measured the same way.** The table
predates Tasks 3–7 and their fix rounds, and the diff `a6b75757..HEAD` carries constructs with no row at all,
including the only production `server/src` code this PR ships. Swept:

- **`sessionws.ts checkMail`'s change gate** (`if (json === this.lastMailJson) return;`) had NO discriminating
  test — the sibling `ask` gate does (`sessionws.test.ts:295`). Deleted the gate; the full relevant suite stayed
  green (a mail frame per ~2 s poll tick, undetected). Closed with a new case, `'does not resend an unchanged mail
  list on a later poll tick'`; re-applying the mutant now fails it deterministically. `server/test/sessionws.test.ts`.
- **The two `checkMail()` CALL SITES** (`start()` and `tick()`) — deleting `tick()`'s call is caught by the existing
  `'pushes freshly queued mail on the next poll tick'` test. Deleting `start()`'s call was NOT caught by anything:
  every existing "on connect" mail test waits up to 36 s across six messages, which is long enough for the first 2 s
  poll tick to deliver the identical frame through the OTHER call site — so the "on connect" tests were silently
  proving the tick's call, not `start()`'s own. Closed with a new case constructing `SessionStream` directly and
  reading `frames` the instant `start()` resolves, before any tick could fire; it fails on the deletion and passes
  on the shipped code, while every timing-tolerant test stays green either way. `server/test/sessionws.test.ts`.
- **`lastMailJson`'s `undefined` (not `null`) sentinel** — measured, and it is VACUOUS under the code's current
  shape: `checkMail` has no `lastMailJson === null && outstanding.length === 0` swallow clause (that clause existed
  in an OLD version the field's own comment describes fixing; the fix removed the clause itself, not just the
  sentinel). Since `JSON.stringify(...)` never produces the literal `null`, `undefined` and `null` compare unequal
  to it identically — mutating the initializer to `null` left the full suite green. The type annotation
  (`string | null | undefined`) still documents the field's history honestly; there is no runtime construct left to
  kill here, and no test claims otherwise.
- **`coord/store.ts`: `OUTSTANDING_STATES_SQL`, `MAIL_ROW_COLUMNS`** — both already killed by existing
  `coord-store.test.ts`/`sessionws.test.ts` cases (state-inclusion and state-degrade assertions land on the shared
  `hydrateMail` column list).
- **`coord/store.ts`: `clampMailLimit`** — UNTESTED at both call sites (`outstandingMailFor`, `mailForRecipient`):
  neither the 100-row default for a non-positive/non-finite ask, nor the 500-row ceiling, nor that the ceiling keeps
  the newest rows. Closed with a 510-row test exercising both boundaries and the ordering; kills a `500→50` mutant
  and a `100→10` fallback mutant, confirmed individually. `server/test/coord-store.test.ts`.
- **`coord/store.ts`: `hydrateMail`'s kind/state degrade-to-`'unknown'` guards** — the KIND guard had no test
  through `outstandingMailFor`/`mailForRecipient` (only `feedEvents`' unrelated kind guard was pinned); the STATE
  guard's only existing test (`delivery()`, two describes up) reads a completely different code path that never
  calls `hydrateMail`. Both were genuine survivors — confirmed by mutating each guard away and watching the full
  relevant suite stay green — closed with two new cases mirroring the established
  "reads a token this build does not know as `unknown`" idiom. `server/test/coord-store.test.ts`.
- **`ccd/install-session-hooks.sh:25`'s fifth default home** (`.claude-dev0`) — already covered, twice over:
  `wrapper-roster-fixture.test.ts`'s source-text pin against `ACCOUNTS.hooksAble` and
  `install-session-hooks.test.ts`'s behavioural "touches exactly the roster's hooksAble config dirs" case. Dropping
  it from the default array fails both, confirmed.
- **PWA fix-round constructs** — `recordKey`/`at`-ordering in `feed.ts` (killed by
  `feed.test.ts`'s epoch-rotation and ordering cases), `runsFrameSeen` (killed by `stores.test.ts`'s own flip
  assertions and `runs-screen.test.tsx`'s stale-cold-snapshot case), and `MailStrip`'s effective ack path —
  `stores/session.ts`'s `disconnect()` clearing `mail` (killed by `stores.test.ts:272`, `MailStrip` itself renders
  nothing once its `mail` prop empties). All three already had discriminating coverage; confirmed by mutation, not
  assumed.

Every mutant above was applied to the real construct, the full relevant suite run foreground, confirmed red (or
green, for the one vacuous case, which is recorded as such rather than force-closed), then restored via `git
checkout --` and diffed clean.

- [ ] **Step 6: Deploy, agent first**

This ships fleet-host artifacts, so the order is not optional — and this time the agent arm also installs a skill and (if minted) a secret:

1. `CCRC_SSH_KEY=~/.ssh/your-key-b bash deploy/deploy.sh agent you@198.51.100.7`
2. `CCRC_SSH_KEY=~/.ssh/your-key-b bash deploy/deploy.sh`

- [ ] **Step 7: Verify the real thing**

Behavioural, demonstrated rather than inferred. **No destructive verbs, and no touching live sessions, during any of it.**

1. **The hook lane's new fifth home — first-ever install into `~/.claude-dev0`:** this branch adds `.claude-dev0` to `ccd/install-session-hooks.sh`'s default `homes=(...)`, and the agent arm scps that installer and runs it (`deploy/deploy.sh` Step 6.1), so this deploy rewrites `~/.claude-dev0/settings.json` on the live fleet host for the first time ever. The installer's own header: *"A settings.json this script broke would break every future session of that home — hence the paranoia."* Verify all four, before touching anything else:
   - `python3 -m json.tool ~/.claude-dev0/settings.json >/dev/null` — valid JSON.
   - The managed session-hook entry appears **exactly once** per event array (the installer's own sweep-then-insert `JQ_PROGRAM`; a stale or duplicated entry means the sweep regex missed a prior install's path).
   - A backup naming that home landed under `~/ccrc-backups/<TS>/claude-dev0.settings.json` — the installer's own `cp -a` rollback path.
   - A re-run (`bash ~/.cc-sessions/install-session-hooks.sh`) changes nothing (`ls -i ~/.claude-dev0/settings.json` before/after — same idiom item 2 below uses for the skill installer).
2. **The skill landed in four homes:** `ls ~/.claude*/skills/ccrc-coordinator/SKILL.md` → four paths, and `bash ~/.cc-sessions/install-coordinator-skill.sh` a second time changes nothing (`ls -i` before/after).
3. **The token landed with the right mode:** `ls -l ~/.cc-secrets/ccrc-mail.token` → `-rw-------`. **Do not `cat` it.**
4. **PR I's token lane really works end to end:** trigger an ordinary swap notice and confirm the server does **not** log the legacy-tolerance warning — i.e. `notify.sh` presented the header and the server accepted it. (PR I's work; verified here because this is the first deploy that has both halves on the box.)
5. **A run appears on the board:** open a run for a throwaway program in a scratch workspace, and confirm `/runs` shows it — from the socket frame, with the network tab showing no `GET /api/runs` after the first paint.
6. **The feed survives a deploy:** send one mail, see it on `/mail`, deploy the server, reload — **the record is still there**. This is the whole reason the durable read exists, and the one thing the old ring could not do.
7. **The negative that matters most:** `touch ~/.cc-sessions/coordinator-paused`, then ask the coordinator to dispatch. It must refuse, report, and **leave the file alone** — then `rm` it yourself and confirm the next dispatch proceeds.
8. **The strip:** mail one live session; the strip appears above its composer with a collapsed headline, and disappears when the mail is acked.

**Amendment (Task 8 fix round 1, 2026-08-11):** item 1 above is new, and it corrects the Global Constraints quote at :187 and the Spec Coverage §9 row (:2968) — *"agent-first is trivially satisfied (no ccd changes)"* is **false for this PR**: `ccd/install-session-hooks.sh` gains a fifth default home, and `server/src/sessionws.ts` + `server/src/coord/store.ts` carry the only production `server/src` changes this plan makes (Task 6). Agent-first ordering (Step 6.1 before Step 6.2) is load-bearing here, not a formality — the fifth home's first-ever settings.json rewrite has to be verified and rolled back cleanly on the agent host before the server, which reads the same box's mail token, ever ships.

---

## Spec Coverage

| spec section | task |
|---|---|
| §5 — the coordinator is a normal session running a skill; fourth artifact in ccd's install lane | 1, 2 |
| §5 — acts through the HTTP API, not raw ccd; the honest boundary named as a contract | 1 (clause 1, and the README paragraph in 7) |
| §5 — caps enforced server-side; pause is a file the coordinator cannot remove | 1 (clause 4), 7 (README), 8 (Step 7.6) |
| §5 — `ws-reap` stays human-only by convention + speed bump, stated as exactly that | 1 (clause 3 + the only-mention test), 7 |
| §5 — the wave lifecycle automates Build 2.5's six steps | 1 (`references/wave-lifecycle.md`) |
| §5 — the brief's content stays discipline; the skill carries the template | 1 (clause 5, `ledger-template.md`, **D-7**) |
| §3 — done-authority is a re-measured fingerprint, typed rejections | 1 (clause 6 + the refusal table), **D-6** |
| §4 — the box token and `/api/notify`'s adoption of it | **PR I** (interface 10); verified here in 2 (Step 5) and documented in 7, **D-8** |
| §4 — the injected envelope is self-describing; ack or it replays | 1 (`mail-envelope.md`, byte-pinned) |
| Operator ruling 2 — placed like any session, which the four-homes lane makes safe | 2 (the installer, and its own docstring) |
| §6 — run board at `/runs`, `/accounts` anatomy, `{type:'runs'}` frame + REST cold start | 5, 3 (the store arm and the client) |
| §6 — run rows: mono, no glow, own status table, work-item tallies, program grouping | 5 |
| §6 — mail feed: first renderer of the durable feed; new kinds with unknown-kind degradation | 3, 4, **D-3** |
| §6 — unread via the pre-committed `isUnseen`/`ack`, badged at the bell | 3 (**D-1**), 4 (**D-2**) |
| §6 — presence-gate exemption surfaced honestly | 4 (`mail-note`, and its own test) |
| §6 — tags do not collapse per session | interface 9 (PR I); consumed here as "two records, two rows", pinned by the dedupe-on-seq case |
| §6 — session mail strip, TaskStrip idiom, nothing when empty; NO ChatItem arm | 6 |
| §2 — the ledger is disaster-recovery ground truth, and a test proves the path | 7 (**D-4**) |
| §7 — the ledger is parsed by nothing | 7 (the structural guard) |
| §9 — rollout agent-first; acceptance is dogfood on Build 4 | 8 (Step 6), 7 (the dogfood subsection) |
| §0 fact 1 — README's local-vs-remote claim corrected | 7 |
| §10 — no PWA mail composition | 6 (the absence is pinned, not assumed) |
| Out of scope here (PR I's) — coord.db, migrations, mail ingress/delivery, caps enforcement, the sweep lane, push minting | nothing in this plan touches `server/src` except one test-only guard |

---

## Self-review — what was checked, and how

- **Every path in the File Structure table was `ls`/`grep`-verified to exist** on `feat/push-actions` (the tree this plan was written against), or is marked Create:. The four PWA screens, `pwa/design/audit.mjs`, `pwa/test/cssRule.ts`, `server/test/tmpHelpers.ts` and `server/test/install-session-hooks.test.ts` were all read in full or in the cited ranges.
- **Anchors verified by read, not by memory:** `app.tsx` routes **41-44**, the `data-view` OR **52**, the detail chain **64-81**; `AccountsScreen.tsx` back control **105-110**; `ArchiveScreen.tsx` rows **83-110**; `FleetScreen.tsx` head **203-210**, bucket bar **295-340** (the `role="group"` rationale **288-294**), archived footer **371-393**; `AccountsStrip.tsx` only-door note **9-15**, `role="link"` **107-115**; `seen.ts` `BADGED` **10**, `isUnseen` **151-155**, `stampFor` **175-177**, `prune` **214-226**; `notifymark.ts` one-way advance **56-65**; `groupFleet.ts` pre-commitment **28-43**; `stores/fleet.ts` `missed` **27-47**, `asFleetMsg` **54-74**, catch-up chain **123-134**, `onMessage` **137-159**; `stores/session.ts` divider-keeping **121-124**, `satisfies never` **166-177**; `TaskStrip.tsx` **28-37**, **67-124**; `SessionScreen.tsx` strip mount **262-264**; `fleet.css` self-grounded note **66-80**, `.fleet-archived-row` **1391-1395**, `.accounts-back` **1409-1428**; `tap-targets.test.tsx` both-halves rationale **13-17**, token **82-88**, literal ban **193-206**; `install-session-hooks.sh` four homes **23-25**, per-home loop **42-65**; `deploy.sh` `ship_env` **30-37**, agent arm **39-82**, `notify.sh` scp **59**; `readme-holds.test.ts` slice **28-34**.
- **The `isUnseen` conflict is measured, not suspected.** `isUnseen`'s signature takes a `FleetSession` and gates on `BADGED`/`bucketSince`; `prune` iterates `Object.keys(acks)` and deletes anything not in the live id set. A feed key in that map is deleted on the next snapshot and the deletion is persisted by `save`. That is **D-1**, and it is the single most important thing to get right in Task 3.
- **The route reservations were checked in `pwa/vite.config.ts`** (the deny-list at `:57` names `/api/`, `/ws/`, `/docs`, `/fleet`): `/runs` and `/mail` are free, and the SPA fallback will serve them.
- **Fastify's param spelling was checked** (`server/src/server.ts:271`, `:344`, `:628`) before the SKILL.md route-linkage test was written on the assumption that `:id` in the prose matches `:id` in the registration — it does, which is what makes that test two lines instead of an allowlist.
- **The "four homes" list was taken from the installer, not from the box:** `ccd/install-session-hooks.sh:25`.
- **`~/.cc-secrets/` was confirmed to exist on the fleet host by the coordinator scout** (`drwx------`, contents deliberately not read). No test in this plan reads a token, and Task 2's `.gitignore` case asserts a committed one does **not** exist.
- **The catch-up/durable split is the scout's S1+S2 finding applied**, not a preference: `NotifyLog.events` is `RING = 200` in memory and `doFlush` persists only `{epoch, seq}` (`server/src/notifylog.ts:6,24,87`), so a feed on the ring alone is empty after every deploy. Hence interface 5's `GET /api/feed`, and hence **D-3**.
- **The sibling plan was read, not assumed.** `docs/superpowers/plans/2026-08-08-build7-core.md` already owns `deploy/notify.sh` (whole file), `ship_secret` (one local token file → **both** boxes), the `.gitignore` line and `deploy/ccrc-mail.token.example` — so the brief's "token shipping story belongs to PR J" would have been a double edit of one file. That is **D-8**, and it also corrected the credential's shape: the header is `x-ccrc-mail-token` (PR I's `MAIL_TOKEN_HEADER`), not `Authorization: Bearer`, and the server reads its own copy from `~/.ccrc/mail.token` rather than an env var — both now carried into the SKILL.md contract clause and the interface list.
- **Not verified, and stated as such:** everything in **Interfaces assumed from PR I** is a contract, not a measurement — none of it exists on this tree. If PR I lands different names, this plan's Tasks 3–6 are the ones that move, and the reconciliation belongs in that section rather than scattered through the code blocks. In particular `renderEnvelope`'s exact output is unknown here, which is why Task 1 Step 6 **prints it and pastes it** rather than guessing a fenced block the test would then fail on.
- **The mutation table was written against the assertions that exist in this plan**, one mutant per added construct; where a construct had no discriminating test, the test was added in its own task rather than the mutant being dropped (the `MailBadge` 412 case and the `run-open`-when-null case both came from that pass).
