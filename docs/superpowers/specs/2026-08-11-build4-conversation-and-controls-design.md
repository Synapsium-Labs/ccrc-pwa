# Build 4 — the conversation surface tells the truth, and the run board grows hands

**Status:** APPROVED 2026-08-11 ("spec looks good") — the five open questions'
embedded recommendations are ratified as written: sheet-hosted live-ask answering;
coordinator-written items via `POST /api/runs/:id/items`; the `coord-pause` verb is
minted; start-a-program is composition over existing routes; abandon releases, never
archives. Read-only scouting on `main`; every claim below was measured at
a file and line, not inherited from a plan.

**Inherits:** the 2026-08-05 Orca analysis's UI/UX item 2 ("the conversation
surface", analysis:155-166) — its *Match* half only, the *Leapfrog* half
having shipped in Build 2 (`specs/2026-08-06-attention-ux-design.md:196-231`).
Inherits three independent reservations naming this build as the sole owner of
the conversation model (`attention-ux-design.md:358`,
`build7-fleet-coordination-design.md:241`, `plans/2026-08-08-build7-surfaces.md`
Task 6). Folds in operator rulings 2026-08-11 (task #17): work items get a
writer; run controls reach the phone. Build 4 is also Build 7's ratified
dogfood — the first program driven through the coordinator
(`build7-fleet-coordination-design.md:281-284, 300`).

## 0. What Build 4 is, in one paragraph

ccrc is the operating console for SDD at fleet scale: the operator's phone is
where a program's state is read and where it is steered. Build 4 closes the
two places that console still lies or goes dumb. It **stops the transcript
misattributing the machine's own words to the operator** — agent-to-agent mail
lands in a worker's context as injected text and today renders as if the human
typed it, and a question the agent is *currently blocked on* renders as a
generic "running" row — so the transcript becomes a true record of who said
what, when. And it **gives the board the two things a console needs and does
not have**: a work-item tally that is written by something (today the plumbing
renders `0/0` forever because no production code has ever inserted a row) and
run controls the operator can reach from a phone (pause the fleet, abandon a
wedged run, start a program). Everything else the original analysis asked for
under "transcript-first" was already true before the analysis was written, and
this spec says so rather than rebuilding it.

## 1. Five measured facts that shaped everything

1. **ccrc has been transcript-first since before the comparison.** `ChatList`/
   `MessageBubble`/`ToolCard` (commit `b3e3519`, predating the analysis) render
   the JSONL-derived `ChatEvent` stream (`shared/api.ts:1428-1434`) as
   structured turns; the pane is a demoted drawer. The analysis's "ccrc renders
   the pane" is false of the tree it described.
2. **Delivered mail is already in the transcript — as the operator's own
   words.** `renderEnvelope` (`server/src/coord/envelope.ts:84`) returns
   ` ```ccrc-mail\n<header>\n<body>\n``` `; `watch.ts`'s sweep types it into the
   recipient's input box through `sendPrompt`, so it lands in the JSONL as a
   **`user` turn** and renders today as a "you" bubble containing a fenced
   block. There is no missing mail *event* — there is a missing **attribution**.
3. **The pending ask is the one live thing the transcript renders as dead.**
   `ToolCard`'s `AskCard` already renders answered `AskUserQuestion` calls as
   questions-with-answers (`ToolCard.tsx:1-11`); while `result === undefined` it
   falls to `GenericToolCard`'s static "running…" (`ToolCard.tsx:202-256`).
   Answering a live ask is only possible from `EnvelopeSheet`/`DialogSheet` or
   the push action — never from inside the scrolling transcript.
4. **Work items have no writer anywhere in production.** `addWorkItem` /
   `setWorkItemState` (`server/src/coord/store.ts:622-631`) are called **only**
   from `server/test/coord-store.test.ts`; `coord/routes.ts` has no `/items`
   path. `itemTally` is already joined into every `RunSummary`
   (`store.ts:559`) and already rendered (`RunsScreen.tsx:97`) — the display is
   finished and the ledger is empty.
5. **The fleet host is read-only to the server except `.cc-clips`.**
   `agent/src/whitelist.ts:79-80`: `mode === 'write'` allows `~/.cc-clips` and
   nothing else. `$REG/coordinator-paused` (`coord/rundefs.ts:52`) is read by
   `dispatchRun` (`dispatch.ts:101-109`) and **written by nothing in this tree**.
   A pause toggle on the phone is therefore not "exposing a route"; it is a new
   fleet-host mutation, and this spec names the cost rather than assuming it
   away.

## 2. The conversation surface

### 2.1 What changes for the operator

- A mail envelope in the transcript renders as a **mail card** attributed to
  its sender — `coordinator → this worker`, kind, subject, run/wave, artifact
  paths as paths — with the body readable and the ack boilerplate folded away.
  It stops reading as something the operator typed.
- A question the agent is **blocked on right now** renders as a live ask card
  with one control, `Answer`, that raises the sheet that already exists. A
  question whose answer landed renders exactly as it does today. A question the
  session moved past without answering reads as *unanswered*, not as
  *waiting for you* — a dead session must not beg forever.
- A tool result the server truncated says so. Today `TOOL_RESULT_MAX = 20_000`
  / `TOOL_INPUT_MAX = 4_000` (`transcript/parse.ts:3-4`) cut silently and the
  PWA renders the fragment as if it were the whole thing.

### 2.2 What the server must newly expose — almost nothing, deliberately

**No new session frame. No new `ChatEvent` kind.** Both were the obvious
designs and both are refused:

- Mail needs no frame because fact 2 already delivered it inside the
  transcript. A second `{type:'mail_log'}` frame would put the same message on
  the wire twice, ordered by two different clocks, and hand the client the
  reconciliation problem. The `{type:'mail'}` frame stays exactly what Task 6
  built: *outstanding* mail for `MailStrip`, replaced wholesale.
- A `ChatEvent` variant (`{kind:'mail'}`) would break older PWAs, whose
  `buildChatItems` funnels every non-tool event into `MessageBubble`
  (`ChatList.tsx:54-73`) — an unknown kind renders as a blank or broken bubble,
  not an honest degradation. The house one-way rule is *old readers drop what
  they do not know*; a variant on a union they already destructure is not that.

The **only** wire additions are:

| Addition | Home | Compatibility |
|---|---|---|
| `MAIL_ENVELOPE_FENCE = 'ccrc-mail'` and `parseMailEnvelope(text)` | `shared/api.ts` (L0) | new exports; `envelope.ts` imports the constant so the fence has **one** definition and a round-trip test proves `parse(render(x))` |
| `truncatedBytes?: number` on `tool_use` / `tool_result` | `shared/api.ts` `ChatEvent` | optional field, **three documented states**: absent = *this server did not report*, `0` = not truncated, `>0` = this many bytes were cut. An old server can only produce "absent", which renders no cue — never a false claim of completeness |

`parseMailEnvelope` returns a typed union, never a bare null:
`{ok:true, envelope}` | `{ok:false, why:'not-mail'}` | `{ok:false,
why:'malformed', at:<header line>}`. The two refusals render identically today
(an ordinary bubble) — stated as a deliberate choice, with a test pinning that
`malformed` never renders as a mail card. The seam keeps the distinction even
though the renderer currently does not need it; collapsing them would be the
overloaded null this repo's architecture doc bans (`architecture:99-100`).

**The PWA holds no rule the server does not also hold.** The envelope grammar
is minted server-side and parsed from one shared definition. The PWA's mail
card asserts nothing beyond "this is the text that was delivered": the
transcript is a rank-3 source and a session can type a fake envelope into
itself. Authoritative mail rows come from the database via the `{type:'mail'}`
frame and `GET /api/feed`; the card is a rendering, never an authorization.
Consequence of a forged envelope: one bubble looks like mail. Named, accepted.

### 2.3 The render model (PWA-owned, and this build owns it)

`ChatItem` (`pwa/src/session/ChatList.tsx:21-26`) gains exactly one member:
`{ kind: 'mail'; key: string; envelope: MailEnvelope; event: MessageEvent }`.
`buildChatItems` recognises an envelope only when the *whole* user turn is one
fenced `ccrc-mail` block; anything else stays a message. Nothing is minted into
`s.events` — the item is derived at render time from the event that is already
there, so the revival discipline (`stores/session.ts:116-177`, the local-divider
rule at `:89-96`) needs **no new clause**: a reconnect re-derives the same card
from the same JSONL bytes. This is the whole reason to build mail attribution
this way rather than as a synthesized row.

The ask card needs **no** new `ChatItem` kind. `AskCard` gains a three-state
axis derived from two sources at once:

| State | Derivation | Cue | Control |
|---|---|---|---|
| `awaiting` | no `tool_result` **and** the store holds a live `ask`/`dialog` for this session | word + glyph, live cue permitted | `Answer` → raises the existing sheet |
| `unanswered` | no `tool_result` and no live envelope (session moved on, or died) | word + glyph, still | none |
| `answered` / `declined` | `tool_result` landed | today's rendering | none |

**One control, one meaning.** `Answer` does not answer — it raises
`EnvelopeSheet`, the one hardened answer path (`inject/ask.ts`'s `askKey`
correspondence, `send.ts`'s settle-before-submit). This is Build 7 D-2's rule
applied to the exact place it would be easiest to break, and it has a second,
mechanical justification: `ChatList` is virtualized (react-virtuoso), so a row
that owned an in-flight answer could be unmounted mid-send by an ordinary
scroll. Dialogs stay screen-hosted.

**No-glow governance, extended.** `/runs` banned `--glow`/`animation`/
`box-shadow` on `.run-*` because a run is a record, not a living pane. Same
rule, same test shape, applied here: `.mail-*` is a record and goes still;
`.ask-*` may carry the live cue **only** in `awaiting`. A stylesheet test bans
the tokens everywhere else under those prefixes.

### 2.4 Degradation rules

- `backlog.missing` keeps its diagnostic banner (`shared/api.ts:1494`) —
  unchanged, restated because a transcript surface that renders empty on a
  missing file is the failure this build exists to prevent.
- Malformed envelope → ordinary bubble, never a half-populated card.
- Absent `truncatedBytes` → no cue. Never "complete".
- The mail card offers **no ack and no reply** — ack is box-token gated and is
  the agent's act (`envelope.ts`'s own `ack:` lines). Pinned by a negative test,
  the `mail-strip.test.tsx` "offers no way to answer" idiom.
- `MailStrip` stays, unchanged, and does not overlap: it answers *"is this
  session sitting on mail it has not acted on?"* (queued/delivered only, by
  server filter). The transcript card answers *"what was said to this session,
  and when, relative to what it did next"* — and by construction can only ever
  show mail that was actually delivered. Two questions, two surfaces, neither a
  second door on one act.

## 3. Work items get their writer (ruling a)

### 3.1 Creation — at dispatch, from a structured field beside the brief

`POST /api/runs/:id/dispatch` body gains `items?: string[]`. The **brief stays
opaque prose and is parsed by nothing** (`build7:216-217`, `build7:246-248`) —
the server never learns to read a wave plan out of English. The coordinator,
which wrote the brief, also declares the item titles; the skill's template
carries the pairing.

- Validation, in `dispatchRun` alongside its existing `brief` checks
  (`dispatch.ts:84-99`): each entry a non-empty string ≤ `WORK_ITEM_TITLE_MAX`
  (200 bytes UTF-8), at most `WORK_ITEM_MAX` (32) entries. Violations →
  `bad-request`, the same untyped 400 shape the brief already uses. Absent or
  `[]` → the run has no declared ledger; that is legal.
- **Ordering is the ordering `dispatchRun` already owns** (D-46): precondition →
  irreversible fleet act → commit. Items are inserted in the same transaction
  as `markDispatched`/`advance`, *after* the transition commits — a refused or
  failed dispatch leaves no orphan rows. Rows are inserted with
  `state:'pending'`, `claimedBy:null`, `blockedBy:[]`.
- **Idempotent by construction:** `RUN_TRANSITIONS.dispatched` has no self-edge
  (`shared/api.ts:1741`) and `dispatchRun` runs behind `CoordMutex`, so a run
  can pass this code exactly once. No dedupe key is needed and none is added.
- **The ledger is fixed at dispatch.** No route adds an item to a dispatched
  run. Work discovered mid-wave is a note in the wave-done mail and an item in
  the *next* wave's brief — that is what waves are for. Consequence, stated:
  the tally can never move backwards and `total` never grows.

### 3.2 Settling — one writer, at the point where a claim is re-measured

New route: **`POST /api/runs/:id/items`**, box-token gated
(`requireMailToken`, `routes.ts:200-211`), body
`{ items: [{ id: number, state: WorkItemState, claimedBy?: string }] }`.
The **coordinator** is the writer at both ends: it creates items at dispatch
and settles them when it processes a `wave-done` — after `verifyDone`
re-measures, which is the moment ccrc is allowed to believe a worker.

Why not the literal reading of ruling (a) — the server special-casing
`subject === 'wave-done'` at `POST /api/mail` ingress:

- It contradicts the build's central invariant: **done-authority is a
  fingerprint, not a claim** (`build7:126-132`). A tally that flips to `5/5`
  off an unverified worker mail is a lie on the console, and the console is the
  product.
- `subject` is an opaque string at ingress today and `MailKind` has no
  item-shaped member. Teaching the mail bus to route on subject text would put
  a parser in the one place the spec kept dumb.
- The *chain* the ruling describes still holds end to end: the worker's
  wave-done mail is what causes the items to be marked done — through the
  coordinator that reads it, exactly as the skill already decides what a
  wave-done means (`ccd/coordinator-skill/SKILL.md`, `references/wave-lifecycle.md`
  §3-4). This is a deviation in mechanism, not in outcome, and it is
  **open question 2** below.

**One enforcement point, no transition table.** Per the architecture doc's own
rejection of `MAIL_DELIVERY_TRANSITIONS` (`architecture:145-147`), work items
have one invariant — `done`/`failed`/`abandoned` are terminal — and it gets one
home: `setWorkItemState` stops returning `void` (today
`store.ts:629-631`, the exact defect the architecture doc names for
`markDelivered` at `architecture:25-30`) and returns
`{ok:true} | {ok:false, why:'unknown-item'} | {ok:false, why:'terminal',
state}`, with the terminality carried in the `UPDATE`'s own `WHERE` clause so
a concurrent writer cannot slip past a read-then-write. A mutant-duty test goes
red when the guard is deleted **and** when it is reordered.

**Refusals** (`RunRefuseCode` gains two members, both entered in
`RUN_REFUSE_CODE_MAP` so the totality scanner sees them —
`shared/api.ts:1891-1907`):

| Code | HTTP | Meaning |
|---|---|---|
| `unknown-run` | 404 | no such run (existing) |
| `unknown-item` | 404 | an item id that is not this run's |
| `item-terminal` | 409 | the item already settled; the write is refused, not silently applied |
| `bad-request` | 400 | shape (untyped, as elsewhere) |

A batch is **all-or-nothing** inside one transaction: a body naming one bad id
settles nothing. Partial success on a ledger write is how tallies drift.

### 3.3 What the tally means on the board

`RunSummary.items` is **per run, therefore per wave** — never per program.
`RunsScreen`'s `{done}/{total}` (`RunsScreen.tsx:97`) stays, with one change:
**`total === 0` renders an em dash, not `0/0`.** A wave that declared no ledger
must not read as a wave that has done nothing — the `summarize()` rule
("drop zero-count clauses rather than print `0 X`", `MailStrip.tsx:32-41`)
applied to the one place it was not.

Two-cue discipline: the tally is a count, not a state, and gets no glyph — but
a run whose items are all settled while the run itself is still `working` is a
legitimate and interesting difference the board already shows through
`RUN_WORD`/`RUN_GLYPH`. Nothing new is invented for it.

### 3.4 Edges

- Items belong to a run, and a run belongs to a wave; closing a run leaves its
  items exactly as they were. An abandoned run keeps its `3/7` — that is the
  record, and the record is the point.
- `blockedBy` stays in the schema (`coord/schema.ts:101-109`) and stays `[]`.
  Nothing writes it, nothing reads it, nothing renders it in this build.
  `doneFingerprint` likewise stays unused — settling is authorized by the run's
  own re-measurement, not by a second per-item one.
- Wave 1 of this very program dispatches before the writer exists on the box,
  so its own tally will read `—`. Said out loud so nobody reads it as a defect
  during the dogfood.

## 4. Run controls on the phone (ruling b)

### 4.1 The authorization ruling, stated before the controls

Every coordination **write** route is gated by `requireMailToken` — the box
token, which authenticates *the fleet host* (`build7:136-143`) and which
`sessionws.ts:276-280` says outright "a browser has no business holding". The
PWA sends no token of any kind (`pwa/src/lib/api.ts`) and already reaches a
dozen mutating routes — `hold`, `release`, `archive`, `reap`, `prompt`,
`ask` — behind the tailnet perimeter alone.

**Operator controls therefore ride the PWA's existing unauthenticated surface,
and the box token is deliberately the wrong key for them.** This is not
convenience. `$REG/coordinator-paused` exists precisely so the coordinator
*cannot* unpause itself ("no verb, no route, no way", `rundefs.ts:47-48`); a
pause route gated by the box token would hand the coordinator — which holds
that token by design — its own unpause. The two doors are different because the
two callers are different, and each act names its cause: run events already
carry `causedBy ∈ {'coordinator','operator',<session id>}`
(`coord/schema.ts:96`). Read routes (`GET /api/runs`, `GET /api/feed`) are
already ungated and stay so.

Honesty clause, in the register of fact 2 of Build 7's own spec: on a
single-uid box any session can already `rm` the marker directly. Adding an
operator route removes no enforcement that ever existed; the skill's contract
(clause 4, `SKILL.md:58`) plus the recorded chokepoint is the boundary, and it
is convention with a speed bump, named as exactly that.

### 4.2 Control 1 — pause / resume

**Server gap, named honestly: this cannot be built server-side alone.** The
server may write only `~/.cc-clips` on the fleet host
(`agent/src/whitelist.ts:79-80`); `FleetIO` has no unlink at all. Creating or
removing `$REG/coordinator-paused` from `<server-host>` requires a fleet-host
mutation that does not exist. The precedent is exact and recent: `ws-hold`/
`ws-release` were granted as ccd verbs for the same reason and with the same
argument — "registry-file writes/unlinks, non-destructive, and granting them
widens nothing that deletes" (`agent/src/whitelist.ts:335-338`).

So Build 4 mints **`ccd coord-pause --state on|off`**:

- `ccd/ccd` gains `cmd_coord_pause` (touch/rm one marker in `$REG`, idempotent,
  echoing the resulting state) plus its dispatch arm.
- `agent/src/whitelist.ts` grants `['coord-pause', '--state']` — two tokens
  wide, matching `REQUIRED_VERB_FLAG` discipline; the `LawfulGrants` proof line
  and `whitelist-noghosts` coverage extend with it.
- `server/src/ccdargv.ts` mints `CCD_ARGV.coordPause(state)` at its call site
  (never table-looked-up — cross-cutting rule (d)).
- `POST /api/coord/pause` `{paused: boolean}` → `verbSupported` check → the
  verb. An agent too old to know the verb answers `501 unsupported`, which the
  phone renders as *"the fleet host needs the newer ccd"* rather than a silent
  no-op. Agent-first rollout is mandatory and is the same lane Build 7 used.

**Reading the state back** — today nothing reports it to any client. Additive
`FleetMsg` member (`shared/api.ts:1412-1419`; old clients drop unknown frame
types, proven by the existing "old client still shrugs" test):

```ts
type MarkerState = 'clear' | 'set' | 'unmeasurable';   // + guard + derived list
interface CoordStatus { pause: MarkerState; mail: MarkerState }
| { type: 'coord'; coord: CoordStatus }
```

`unmeasurable` is not decoration: `dispatchRun` treats an unlistable registry
directory as a pause it cannot rule out and **fails shut**
(`dispatch.ts:106-109`). The wire must be able to say the same thing, or the
phone would render "running" for a state the server would refuse to dispatch
in. One `MarkerState` type covers both markers because they are one concept
read one way — `coordinator-paused` and `mail-disabled`, from the single
`readdir` the fleet lane performs. No new cadence: the emit rides the existing
fleet poll, and the frame is sent only when the value changes.

Client rules: *frame not yet seen* is a fourth, **client-side** state
(`runsFrameSeen`'s idiom, `stores/fleet.ts`) rendered as nothing — never as
"not paused". Two cues, word + glyph, from parallel `Record<MarkerState,…>`
tables. The toggle is **not** optimistic: it renders `pausing…` / `resuming…`
and settles only on the next `coord` frame; if no frame confirms within the
poll window it renders `unconfirmed — check /runs`, never a silent flip. The
banner lives on `/runs` (the coordination surface) and nowhere else.

**Refusals to render:** `501 unsupported` (old agent), `502 {stderr}` (the verb
failed on the box), and the read-side `unmeasurable`. There is no
`bad-request` path worth a distinct string beyond the generic toast.

### 4.3 Control 2 — abandon a wedged run

**Route:** `POST /api/runs/:id/abandon`, operator surface (§4.1), body `{}`.
It calls the **same L1 decision function** `closeRun` (`coord/close.ts`) —
architecture increment 4's "deciding split from acting" is not duplicated for a
second caller. Three small, named changes inside it:

- **D-274 (was D-B4-1) — an abandon carries no fingerprint.** Today `closeRun` demands a
  shape-valid `{branchTip, prNumber, prPhase, handoffCommit}` and a boolean
  `final` *before* the D-49 branch that skips re-measuring it
  (`close.ts:143-160`). An operator abandoning a wedged run has no such claim
  and should not have to invent one. `CloseRunBody` gains an explicit abandon
  variant — `{intent:'abandon'}` — validated as its own shape; `handoffCommit`
  is written `null`, exactly as the existing `HANDOFF_SHA` guard would have
  produced.
- **D-275 (was D-B4-2) — an abandon skips the `.prhistory` fold.** Today an unreadable
  ledger refuses the close (`prhistory-unreadable`, `close.ts:161-166`) — which
  would disable the abandon in precisely the broken-box case it exists for. An
  abandon asserts nothing about PR lineage, the same reasoning D-49 already
  uses for skipping `verifyDone`. `prLineage` stays unfolded and the run record
  says so.
- **D-276 (was D-B4-3) — `causedBy` becomes a parameter.** `closeRun` hardcodes
  `causedBy: 'coordinator'` (`close.ts:171`). An operator abandon must record
  `'operator'`, which the schema has always allowed (`schema.ts:96`).

**The `planned` gap, closed narrowly.** `RUN_TRANSITIONS.planned` has no
`closing` edge and the exclusion is deliberate and documented
(`shared/api.ts:1720-1738`) — but `planned` is exactly where an
`ambiguous-dispatch` leaves a wedged run, so "abandon on a wedged run" that
cannot touch `planned` is not the feature. **`RUN_TRANSITIONS` is not
modified** (clients read that table as a refusal vocabulary; changing it
changes what every deployed client believes). Instead the abandon path uses the
`planned → failed` edge the table **already has** (`shared/api.ts:1741`), with
no `closing` hop and no fleet act unless there is something to release:

| Wedged shape | Fleet act | Transition |
|---|---|---|
| `planned`, `sessionId === null` (ambiguous dispatch) | none | `planned → failed` |
| `planned`, `sessionId` set (wave ≥2 reclaim holding a workspace, D-45) | `ws-release` | `planned → failed` |
| `dispatched` / `working` / `awaiting-review` / `merging` | `ws-release` | today's `→ closing → failed` |
| `done` / `failed` | none | refused `bad-transition` |

The fleet act stays **ahead of** the transition commit (D-48), so a failed
release leaves the run retryable rather than wedged terminal.

**The phone can abandon; the phone can never archive.** `close`'s
`archive:true` branch is the one explicit `wsArchive` in the coordination lane
(`close.ts:140-146`) and it destroys a worktree. The abandon route does not
accept the flag at all; destruction keeps its existing ceremony (audit → reap,
typed `expect`). A two-tap confirm in the sheet naming the run and its
workspace is the whole ceremony here, because a release destroys nothing.

**Refusals to render, each with its own copy:** `404 unknown-run`;
`409 bad-transition` (with `from`, so the phone can say *"this run already
closed"*); `409 not-dispatched` is **not** reachable on this path any more and
its absence is pinned by test; `501 unsupported`; `502 {stderr}` from the
release. `prhistory-unreadable` and the five `verifyDone` codes are
structurally unreachable here (D-274 (was D-B4-1) and D-275 (was D-B4-2)) — also pinned, so a later edit that
re-introduces them fails a test rather than a phone.

### 4.4 Control 3 — open a program

`POST /api/runs` is the coordinator's own route: it demands `claimedBy` = a
live coordinator session id and refuses a second claimant
(`routes.ts:660-709`). There is no coordinator to name before one exists, so
"open a program" on the phone is **not** that call, and this build does **not**
add a compound server route that both spawns a session and opens a run — that
would put the one chokepoint's decision in two places.

The flow composes routes the PWA already has:

1. Operator taps *Start a program* on `/runs`, gives **program slug**, **title**,
   **project**.
2. The PWA creates a coordinator session in that project — `POST /api/sessions`
   (existing, `_ws_least_loaded` placement per operator ruling 2026-08-08).
3. The PWA sends that session one standing kickoff prompt — `POST
   /api/sessions/:id/prompt` (existing) — naming the program slug, the ledger
   path `docs/superpowers/programs/<slug>.md`, and instructing it to run the
   coordinator skill.
4. The **coordinator** opens the run through `POST /api/runs` as it does today.
   The run row appears on the board when it exists — not before.

**The server never validates the ledger and the phone must not pretend to.**
`POST /api/runs` deliberately neither reads nor writes
`docs/superpowers/programs/<slug>.md` (`routes.ts:641-659`); the flow's
confirmation screen *names the path* the operator is expected to have
committed, which is the same thing that route does, and stops there.

**What it renders while pending:** the session-create call is the only
long one; it shows the ordinary in-flight state and, on success, navigates to
the new session — the run row arrives later, on its own, from the coordinator.
The screen says so in one line rather than spinning on a row that is not the
PWA's to create. If `coord.pause` is `set` when the sheet opens, the sheet
**warns and does not block**: the coordinator will be refused `paused` at its
first dispatch, and finding that out from a banner beats finding it out from an
agent's report.

**Refusals to render:** unknown project (400), no home-able account / spawn
failure (`502 {stderr}`), and the pause warning above. Caps
(`cap-concurrency`, `cap-daily`) cannot refuse here — they refuse at dispatch,
inside the coordinator's own loop, and the board shows that refusal where it
happens.

## 5. Non-goals, explicitly

- **Thinking blocks, sidechain/subagent turns, and image content blocks in the
  transcript.** All three are dropped server-side in `transcript/parse.ts`
  (`:43`, `:85-103`, no `image` arm) — the PWA never sees them. Restoring any of
  them is a parse-layer decision with its own cost (sidechains alone can
  multiply a transcript) and belongs to whoever asks for it. Subagent *presence*
  already ships on the fleet card (`SessionLine.tsx`).
- **"Load older messages."** The backlog is the last 1 MB / 50 events
  (`transcript/tail.ts:11`, `sessionws.ts:16`) after an unbounded read once took
  an agent to ~1.9 GB RSS. No REST history route, no pagination, no
  infinite-scroll. Not in this build.
- **Terminal fidelity** (analysis UX item 3) — an explicit separate non-goal
  already (`attention-ux-design.md:360-361`), not folded in here.
- **Wiring `ai-title`.** `transcript/title.ts:29-55` is written, unused, and
  collapses three conditions into one null (`:18-22`) — the clearest overloaded
  null in the Session Conversation context. Named as known debt; fixing it means
  designing a surface for it, and nothing asks for one.
- **A second way to answer an ask.** The sheet and the push action are the two
  existing answer paths (both Build 2's, both hardened); the transcript adds a
  *route to* the sheet, never a third sender.
- **PWA mail composition or ack**, **outbox rendering**, and any change to
  `askSummary`'s one-line fleet-card form (Build 2 owns it).
- **`blockedBy` DAG semantics, per-item worker claims, per-item done
  fingerprints, adding items to a dispatched run, item history/events.**
- **Editing `RUN_TRANSITIONS`**, parsing the brief, parsing the ledger,
  multi-coordinator arbitration, archive-from-phone, and any new authentication
  story for the PWA (the tailnet stays the perimeter; §4.1 explains why the box
  token is the wrong key rather than replacing it).
- **Push actions for mail or run controls.** Push copy stays as Build 7 left it.

## 6. Testing, rollout, failure modes

- **Wire totality:** `MarkerState` and the two new `RunRefuseCode` members join
  the existing totality scanners; the `{type:'coord'}` frame gets the
  "old client still shrugs" test; `applySessionMsg`'s `satisfies never` default
  arm is untouched because no session frame is added.
- **Round trip:** `parseMailEnvelope(renderEnvelope(x))` reproduces every header
  field, for the artifact-bearing and artifact-free shapes, plus a fence-length
  case (`fenceFor`, `envelope.ts:21-25`) and a malformed-header case.
- **Negative pins** (the `mail-strip.test.tsx` idiom): the mail card offers no
  ack/reply; the ask card offers no direct answer; the abandon route cannot
  reach `archive`; `verifyDone`/`prhistory-unreadable` are unreachable from
  abandon.
- **Mutant duty in `coord/`:** the item-terminality guard goes red when deleted
  *and* when reordered.
- **Design gates:** one stylesheet per new surface, self-grounded rules, tap
  floor via `var(--tap-min)` proven on a rendered element, no-glow scan over
  `.mail-*`/`.ask-*`, `role="group"` never a named landmark that can be empty,
  and the door on `/runs` still renders at zero runs.
- **Rollout order is forced and is Build 7's:** ccd verb + agent whitelist +
  coordinator skill (fleet host) → server → PWA. A PWA that ships before the
  verb renders a pause toggle that answers `501` for every tap.
- **Failure modes:** registry unlistable → `pause: 'unmeasurable'`, dispatch
  already fails shut, the phone says so. Agent old → `501`, rendered. Server
  restart → nothing new is in memory; items and markers are DB/file state.
  Envelope format changed without updating the shared constant → round-trip
  test fails before deploy.
- **D-46 proves itself in production here**, per architecture increment 4: the
  dogfood's own dispatches exercise the precondition-before-act ordering with a
  real coordinator and a watching operator.

## 7. Dogfood shape — four waves, seams on bounded contexts

Build 4 is an unusually good first program because its work splits along
**bounded-context lines**, so no two waves touch the same file. It is also
self-referential in a useful way: wave 1 builds the ledger that waves 2–4 are
then counted by.

**Wave 1 — Coordination: the writer.** `items` on the dispatch body; the
`POST /api/runs/:id/items` route; `setWorkItemState`'s typed result and single
terminality point; the two new refusal codes; the `total === 0` tally
rendering; the coordinator skill's brief/items template. Server + `shared/` +
skill. First, so tallies are live for the rest of the program (wave 1's own
tally reads `—`; §3.4).

**Wave 2 — Fleet Mutation + Coordination: the run-control substrate.** The
`coord-pause` verb in `ccd`, the whitelist grant, `CCD_ARGV.coordPause`,
`POST /api/coord/pause`, the `{type:'coord'}` frame and its emit,
`POST /api/runs/:id/abandon` with D-274 (was D-B4-1), D-275 (was D-B4-2), D-276 (was D-B4-3) and the `planned` path. Fleet host
+ server + `shared/`. **Deployed agent-first**, which makes it the wave that
exercises the coordinator's real rollout discipline.

**Wave 3 — PWA: the console's hands.** Pause banner + toggle with the
unconfirmed state, abandon sheet with its refusal copy, the start-a-program
flow. PWA only, consuming wave 2's wire. Cleanly parallelizable against wave 4
if the operator wants two workers — different directories, no shared files.

**Wave 4 — Session Conversation: the transcript.** `MAIL_ENVELOPE_FENCE` +
`parseMailEnvelope` in `shared/`, `truncatedBytes` in `parse.ts`, the mail
`ChatItem`, the three-state ask card and its `Answer` control. One context, one
vertical slice, and the only wave that touches `ChatList`/`ToolCard` — the two
files three prior specs reserved for exactly this.

**Risk note for whoever splits the waves further:** if open question 1 is
decided the other way (retire the sheet, answer inside the transcript), wave 4
grows to touch `inject/ask.ts` and `inject/send.ts` — the settle-before-submit
machinery Build 2 fixed live, where a regression is a wedged live session, not
a cosmetic bug. That wave should then be split off on its own rather than ride
with the mail card.
