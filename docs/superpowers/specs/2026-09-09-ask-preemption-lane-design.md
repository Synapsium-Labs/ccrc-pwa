# The ask pre-emption lane — a parent rules its children's questions, or you do

**Status:** design agreed 2026-09-09, not yet planned. Operator directive: "a session created by a
user should always spawn as a coordinator session", and "when a spawned workspace session has
questions … it should seek answers from the coordinator … the coordinator should be more or less
the only workspace that asks the user direct questions and acts as a distributor, controller and
validator."

**The design in one sentence:** a child raises an ordinary `AskUserQuestion` and blocks exactly as
today; the server notices, tells that child's parent, and **holds the operator's push** for a grace
window — if the parent rules first, the operator never sees the question, and if it does not, the
push fires unchanged with its lock-screen buttons.

**What this is not:** a new message channel. The child does nothing new, and `README.md:52`'s
lock-screen answer keeps working byte-for-byte for every ask the parent does not pre-empt. The only
session that learns a new protocol is the parent.

**Corrected — `answerAsk` WAS modified (Task 20, D-2177).** This sentence said it was not, and the
implementation deliberately changed it: `answerAsk` now checks `sendKey`'s boolean and refuses
`not-alive` where it used to return `{ok: true}` for a keystroke that never arrived. That was right,
and it is this design's doing: `cmd_swap` destroys a live pane and was the one such operation not
serialized against `answerAsk`'s capture-then-send window, so a swap landing mid-answer produced a
`{ok: true}` naming a digit nobody received. Pre-existing — but the lane makes a SECOND principal
press keys into a pane the operator may be swapping at the same moment, which is what turned a latent
lie into one the ask row would have recorded as an answer. §8.8 already asked for both halves; the
sentence above simply predated it. What the sentence was protecting is still true: the change is
strictly a refusal where there used to be a false success, so no ask that would have been answered
before is refused now, and the operator's lane is byte-identical on every path that actually pressed
a key.

---

## 1. Why the obvious design is impossible

The natural reading of the directive is "the child mails its question to the coordinator and waits."
That design was drafted and killed. Three measured facts:

**F1 — a session blocked on `AskUserQuestion` cannot receive mail.** `watch.ts:2685` is
`if (hs !== null && hs.ask !== null) { gated(d, 'pending-ask'); continue; }` — a bare `continue`. It
does not `backOff`, does not ratchet `attempts`, and does not count toward the replay ceiling, so the
row stays due and is re-walked forever. Question-by-dialog and answer-by-mail are mutually exclusive
by construction.

**F2 — so the child would have to end its turn, and that is what costs everything.** `askActions`
(`askkey.ts:75-91`) mints the push's option buttons only when the asking session is live-blocked with
a matching pane menu; a child at `done` with `ask: null` can only ever get an actionless deep link. The
round trip child→parent→operator→parent→child has a machine floor near 170s with a zero-latency
operator, against ~2-4s for today's tap. And the fast mail constants (`COORD_QUIET_MS` 15s /
`COORD_COOLDOWN_MS` 30s, `watch.ts:229-230`) are selected by membership in `openCoordinatorIds()`,
which reads `runs.claimedBy` — so a parent with no open run is scored as a worker at 60s/120s.

**F3 — and a child that ends its turn is the textbook auto-compact candidate.**
`_auto_compact_check` (`ccd/ccd:12741`) fires at 50% context after 60s idle at a clean `❯` prompt. The
mailed-question shape puts the child in exactly that state for longer than 60s by construction. The
race shape is structurally immune: the same function refuses on `grep -q "❯" || return 0` and on
`[[ "$st" == "idle" ]]`, and a session showing a dialog satisfies neither.

**A fourth fact makes the race possible.** `answerAsk` (`server/src/inject/ask.ts:33-38`) carries
twelve pre-send guards plus two post-send `sendKey` checks (D-2177) and nine typed fail-shut
refusals, re-reads hookstate through `AskDeps.readAsk` rather
than trusting any caller's copy, and — the load-bearing part — **re-captures the pane at send time**
and refuses `no-menu` / `menu-mismatch` before pressing anything. Every call for one session
serializes through a shared per-session `KeyedQueue` (`server.ts:1404-1406`). A race between two
principals is therefore already survivable at the primitive; this design has to avoid *adding* a way
to lose it.

---

## 2. The lane

```
child raises AskUserQuestion, blocks                    (unchanged — the child does nothing new)
  │
  ├─ detectDialogs sees it. Is a parent derivable, and is this ask eligible?
  │     no  ──────────────────────────────────────────► push fires now. Today's behaviour.
  │     yes ──► mint the record (recordAlways+recordOnly)
  │             hold the push in memory, heldUntil = now + GRACE
  │             mail the parent, kind 'question', subject ask:<id>
  │
  ├─ parent rules      POST /api/asks/:id/answer     ──► CAS held→answering ──► answerAsk ──► digit
  │                                                      operator never saw it; second record minted
  ├─ parent declines   POST /api/asks/:id/release    ──► push fires AT ONCE
  ├─ window lapses     release sweep                 ──► push fires, unchanged, with its buttons
  └─ dialog vanishes   watch's dialog_cleared        ──► row goes stale; hold dropped
```

### 2.1 The child does nothing new — because it cannot

A child cannot file an ask and then block: `AskUserQuestion` holds the turn, so there is no "then". It
would have to POST first and call the tool second, and the two could drift into a question the parent
answers that the child is not showing.

The server needs no help. `hookstate.ask` already carries the structured `{questions:[...]}` envelope
(`session-hook.sh:932-948`); `detectDialogs` (`watch.ts:3218-3299`) already notices the dialog every
tick by pane scrape, independent of hookstate; `askKey` already hashes the first question's text and
option labels; `askActions` already decides answerability. **The ask row is the dialog restated**, so
no drift is possible.

### 2.2 Eligibility is `askActions`, not a hand-kept list

**An ask is held only if `askActions(hs)` returns non-null.** That single already-shipped predicate —
whose stated contract is "offer an action only where `answerAsk` would accept it" (`askkey.ts:35-36`)
— closes every case the lane must not touch, in one comparison:

| case | why it must not be held | closed by |
|---|---|---|
| permission approval | no `askKey` at all; `answerAsk` always answers `ask-mismatch` | `askActions` null arm |
| multi-**question** ask | `answerAsk` refuses `multi-question` unconditionally (`ask.ts:64-65`) — no principal can ever answer it | same |
| multi-**select** ask | a single index presses the digit *and Enter*, committing an irrevocable one-of-N | same |
| free-text / blank-label | refused `range` / `menu-mismatch` at send time | same |

Holding any of these would mean a grace window that can never resolve to an answer — pure latency
with no upside. A hand-maintained carve-out for approvals alone (an earlier draft's mistake) leaves
the other four open.

**The answer route still accepts `optionIndexes: number[]`, never a singular field**, matching
`server.ts:1602`. Under `askActions` eligibility only single-select asks are ever held, so the array
carries one element today — that is the point. The singular field is what re-opens the multi-select
hazard, and it re-opens it *silently*, at whatever later date someone widens eligibility. The wire
shape should not be the thing that has to be remembered.

### 2.3 The hold is in memory; coord.db holds the record and the mutex

The deferred push lives in a watcher-local `Map` beside `dialogIds` (`watch.ts:326`) and
`actionlessAsks` (`watch.ts:340`), carrying `{heldUntil, payload}`. The release sweep reads that map.

This is not a preference, it is the D8 ruling working correctly. `dialogIds.set()` fires
unconditionally on first sighting (`watch.ts:3279`) whether or not the push was raised, so the edge
that would re-raise it is already spent. If the deferred push lived only in coord.db, losing the
database would not degrade the feature to today's behaviour — it would **delete the notification
permanently**, for exactly the sessions the feature exists for. With the hold in memory, a lost
coord.db means: no parent can be told, no parent can answer, every push fires unheld. Today's
behaviour, which is what "loss is free" has to mean.

> **D8 ruling for `asks`, to be written where the table is born** (the `claims` / `ledger_alloc`
> precedent, `schema.ts:444-462`): the asks table is a RECORD and an answer mutex. It is authoritative
> for neither the question (the live pane is) nor the deferred push (the watcher's memory is). Its
> loss is free: every held ask degrades to an immediate push. The residual is stated honestly — a
> server restart mid-hold loses that push, which is **pre-existing** (`this.primed` is false on the
> first tick after boot, `watch.ts:747,914`, and `dialogIds` suppresses the second), not a regression.

### 2.4 The record is minted at hold time, not at release

`pushOne` returns *before* it records when presence says the operator is looking
(`watch.ts:1225-1226`), so record and push are one act at that call site. Holding naively therefore
deletes the operator's only durable trace: if the parent wins, nothing lands in `notify_log` or
`feed_events`, and a decision made in the operator's name leaves no residue anywhere.

Both flags needed already exist and were added for this exact distinction — `recordAlways` ("the
presence gate still suppresses the push; only the RECORD is exempt", `watch.ts:1209-1218`) and
`recordOnly` ("record it … but never emit an actual push", `watch.ts:1216-1223`). So:

- **at hold:** `pushOne({kind:'ask', …, recordAlways: true, recordOnly: true})` — one ring event, one
  `feed_events` row, no buzz.
- **on a parent answer:** a second record naming the parent and the option it chose.
- **on release:** the held payload is pushed verbatim — reproduced from the snapshot, not recomputed,
  because nothing today persists a tick-local closure past its tick.

### 2.5 The instance guard — the one genuine wrong-answer path

`askKey` is a pure content hash of the first question's text and option labels. It identifies a
**question, not an ask instance**: a child looping over N items regenerates it byte-for-byte each
time, and nothing in the tree — not the hook, not `parseDialog`, not the key — can tell instance 1
from instance 2. A grace window is precisely a delay inserted where that substitution can happen.

> A worker asks "Apply this migration to the next table? [1 Yes] [2 No, skip]" once per table. Instance
> 1 paints; the ask is minted and held. The operator answers "No, skip" at the terminal. The child
> loops and repaints the identical menu inside the same 2s tick, so `last === dialog.id` and neither
> `dialog_cleared` nor a new-dialog event fires. The parent's mail lands at T+65s and it answers row 1.
> Fresh hookstate says `waiting`; the key matches; `hasMenu` passes; `pairMatches` passes. A `1` lands
> and **table 2 is migrated** — by a parent answering a question it never read, recorded against a row
> whose snapshot describes a different instance.

**Mitigation, one integer:** the row stores `askAt = hs.updatedAt` (written per hook event,
`session-hook.sh:1236`, surfaced at `hookstate.ts:22`). `POST /api/asks/:id/answer` re-reads hookstate
and refuses unless the fresh `updatedAt` still equals `askAt`, **before** calling `answerAsk`. It fails
shut, it lives only in the new route so `answerAsk`'s operator-lane semantics stay byte-identical, and
it gives the row a real `held → stale` transition that does not depend on `dialog_cleared` — which
matters, because this is the one case `dialog_cleared` structurally cannot see.

**Say plainly which principal is guarded: only the parent.** The argument above is "a grace window is
a delay inserted where question substitution can happen", and the operator's push is delayed by *that
same window* — yet `POST /api/sessions/:id/ask` carries no instance guard, and this design does not
give it one. That is defensible, and it is defensible for a reason that has nothing to do with the
window: the operator's own latency was ALREADY unbounded. A push sits on a lock screen until somebody
picks the phone up, so the gap between the menu `askKey` identified and the digit landing has always
been minutes-to-hours, bounded by nothing, and `answerAsk`'s content key is the only thing that has
ever stood between it and a substituted instance. The grace window widens that pre-existing exposure
by at most GRACE — a few percent of a realistic tap latency — and closing it would mean changing
`answerAsk`'s operator-lane semantics, which §2.7's whole promise is that this design does not do. So
the honest statement is: the parent, a new principal answering a question it did not read, is guarded;
the operator, an old principal whose exposure this design only widens slightly, is not. A reader must
not infer from §2.5 that both are.

### 2.6 The row is the mutex

`answerAsk`'s own loser-refusal (`not-waiting`, `no-menu`) requires the child's world to have visibly
moved, and it returns when `tmux send-keys` exits — not when Claude Code has consumed the digit. Two
principals sending *different* answers ~40ms apart can therefore both observe the pre-answer world.
The comment at `ask.ts:92-97` that covers this names only "a retried request, a double-tap": one
principal, same answer, where losing is harmless.

So the ask row, not the pane, is the mutex. A synchronous `UPDATE … WHERE state='held'` CAS to
`answering` runs **before** `answerAsk`, on the single-writer `DatabaseSync`. The operator's own
route closes the row the same way, also before `answerAsk`. One row, one keystroke; the loser gets a
typed refusal from the row instead of a digit into an unknown pane. On the parentless path no row
exists and nothing changes.

### 2.7 What the operator loses, precisely

Nothing on the answering side: for every ask that lapses or is declined, the push, its option buttons,
`askKey`'s "you answer the question you were shown" identity, and the whole
`push-sw.js → POST /api/sessions/:id/ask → answerAsk` chain are untouched. Spec §5's "the ordinary
ability to just talk to any session" is likewise untouched — this design changes who *initiates*
upward, never the operator's reach downward.

("Untouched" reads with §2's own correction above: `answerAsk` gained one post-send check, D-2177,
which turns a `{ok: true}` for a keystroke that never landed into a refusal. Every path that actually
pressed a key behaves exactly as it did.)

What the operator loses is **immediacy on questions the parent answers**: up to GRACE seconds of not
being buzzed, and — when the parent rules — never being buzzed at all. §2.4's record is what makes
that reviewable rather than silent, and §5's kill switch is what makes it revocable.

And the child loses nothing at all. It never ended its turn, so its context, its place in the task and
its transcript are exactly as they were; a pre-empted ask is indistinguishable from a fast operator.
This is what makes F3 (auto-compaction) a non-issue rather than a hazard to be gated.

### 2.8 The operator's surface

**No new screen.** The push, `DialogSheet`, `ToolCard`'s Answer control and the whole answering chain
are untouched, so a lapsed or declined ask is answered exactly where it is answered today. What the
PWA gains is small and additive:

- **a chip on the child**, rendered from the ask row: *held — <parent> may answer* while the window is
  open, and — once it is ruled — one of *ruled by <parent>*, *answered by you* when the operator
  settled it themselves from their own phone, or a flat *answered* when the row names no principal at
  all. **Corrected by F1 (whole-branch review):** this bullet said "*ruled by <parent>*" and nothing
  else, and the chip was built to match — from `parentId`, never reading `answeredBy`. Task 12 had
  already made that false BEFORE the chip was written: `POST /api/sessions/:id/ask` takes the held row
  and settles it as the operator. So the one surface this lane exists to make honest attributed the
  operator's own answer to a session that did not give it. Both bounds are stated too: the *answered*
  chip lapses after `ASK_ANSWERED_CHIP_WINDOW_MS`, and the *held* chip after the grace window plus the
  answering ceiling (F2(b)) — a held row older than that is stale by construction, since the process
  that would have moved it either is not running any more or has already given up on it. The child's
  `attention` bucket is unchanged throughout, so a held ask is never hidden from the fleet view — only
  from the notification.
- **the feed already carries the record**, because §2.4 mints it with `recordAlways`/`recordOnly` at
  hold time and again on a parent answer. `/mail`'s existing `NotifyEvent` rendering shows both without
  a new component; the second event is what answers "what was decided in my name, and by whom".

  **Scope that claim to the PRE-EMPTED path, which is the only place it holds.** "The row and the feed
  both record who ruled" is true when a parent answers, and true when the operator answers *while the
  row is still held* — `POST /api/sessions/:id/ask` takes the row and settles it as `operator` (Task
  12). It is NOT true after a lapse. The release sweep settles the row `released` with `answeredBy`
  permanently `null`, the push fires, and the operator answers it from the lock screen minutes later —
  at which point `heldAskFor` finds nothing, because it is scoped to `state = 'held'`. So that answer
  records NOTHING on the row: no `answeredBy`, no `answer`, no second feed event. This is not a defect
  to fix here — a lapsed ask is an ordinary ask, answered exactly as every ask was answered before this
  lane existed, and the ordinary path never recorded an answerer either. But the sentence above should
  not be read as a claim about every ask. What the lane records is what it *changed*: a decision made
  in the operator's name that never reached their phone.

`GET /api/asks` serves the parent's cross-sibling read (§6.1). **Corrected by D-2310 (Task 19, fix
round 1):** the PWA's chip is NOT served from this route — it is computed server-side in `fleet.ts`'s
`assembleFleet`, reading `CoordStore` directly, the same way every other `FleetSession` field is
computed. Routing the fleet frame through an HTTP call to the server's own route would be a new
pattern for no gain. As of that ruling, `GET /api/asks` has zero PWA consumers; it remains the
parent's cross-sibling read and is available for any later PWA list view. It is still the third of
the three new lanes §8.1 counts — the route exists exactly as built, only its PWA-chip consumer
does not.

---

## 3. Provenance — derived, never stored

An earlier draft minted a `~/.cc-sessions/<id>.origin` sidecar. It is deleted, for two reasons that
are both measured.

**It would be redundant.** `ccd ws-add --actor <text>` already journals a `create` lifecycle row that
ccd's own comment calls "the journal's whole record of a spawn's origin" (`ccd:4424,4443`), and the
server already reads that back (`reviveDec`, `journalparse.ts:127-153`).

**It would be wrong.** A stored parent id names a corpse the moment a program is reclaimed;
`reclaimProgram` rewrites `runs.claimedBy` for every run of the program in one transaction
(`store.ts:698-748`), so a derived parent follows a reclaim for free.

**And its default would have been a lie.** `origin` treated an undeclared spawn as `operator`. Under
AGENT-FIRST ordering the new ccd runs under the old server for hours, and that server passes no parent
token — so every worker dispatched in the window would be permanently stamped
`operator` = coordinator-capable, write-once, no backfill. **Absence means NO PARENT, never a positive
`operator`.** That arm is exactly today's behaviour, so every session alive at cutover is untouched by
construction.

### 3.1 Case A — a program worker (works on day one)

`SELECT claimedBy FROM runs WHERE sessionId = ? AND state NOT IN (terminal) ORDER BY id DESC LIMIT 1`.
The `runs_by_session` index exists (`schema.ts:241`) and `runs.sessionId` is populated at run-open
(`routes.ts:963-965`) before any dispatch, so waves 2..N are covered. The PWA already performs this
join client-side (`RunSummary.claimedBy`, "the programme-ownership edge").

Two honest caveats: **no store method returns this today** — `openRunsForSession` (`store.ts:1534`) is
deliberately narrowed to three fields and `resolveCoordinator` is keyed by run id, so this is one new
~3-line method. And nothing in the schema forbids two open runs naming one `sessionId` — the
coordinator protocol *deliberately* creates that state by opening wave N+1 before closing wave N
(`store.ts:1526-1529`) — so `ORDER BY id DESC LIMIT 1` is a convention, and carries the same
protocol-not-DB-enforced caveat `close.ts`'s `survivorOf` already documents.

### 3.2 Case B — an ad-hoc child (a new pattern, not existing wiring)

R3 makes parenthood structural rather than program-bound. On the mechanism, that is aspirational
today: **dispatch is the only caller in the tree that spawns a session from a session**, the one
existing `dec.actor` value is `run:<id> dispatch`, and **no code anywhere parses a `session:` prefix**.

So Case B is three new things, and the plan must budget them as such: a write-side convention
(`--actor session:<id>`), a read-side parser, and a purpose-built `act='create'` query on the
`lifecycle_by_session` index — *not* `lifecycleFor`, whose 500-row window silently misses the parent
for any long-lived session. It also introduces an unauthenticated trust surface: `--actor` is free
text, ≤512 bytes, validated only for non-blankness (`_lc_dec_ok`, `ccd:2756-2767`), so a session can
self-report as parent of a future child. That is attribution, not authentication — the same standing
posture as the rest of the fleet — but it must be **written down** rather than discovered.

**Recommendation:** ship Case A first; Case B is a second wave with its own argument.

---

## 4. The role at birth

Nothing happens at creation. Being an ask-parent is automatic the moment a session spawns anything,
because §3 derives it. What is left is the coordinator skill's *invocation*, and it is **lazy**: the
first ask mail carries it, so a session learns it is a parent exactly when it becomes one, and a
session created just to chat with stays a plain session forever. No kickoff mail on every `ccd start`.

This satisfies the directive's intent without its literal mechanism: a user-created session is
coordinator-*capable* from birth in the only sense that has consequences, and pays nothing until it
has a child.

---

## 5. Kill switch

Every autonomous lane in this tree gives the operator a file. This one gets `$REG/asks-disabled`, read
in the same fail-shut directory listing `sweepMail` already performs (`watch.ts:2202`). When present,
**never hold** — every ask pushes exactly as today.

`coordinator-paused` cannot be borrowed: R3 decouples parenthood from programs, so most parents are
not coordinators, and pausing one that is stops its dispatch while leaving it free to keep answering
its already-running children. Without `asks-disabled` the only remedy for a parent making bad calls is
to kill the session and forfeit the run.

---

## 6. Skills

R7: **no operator-only marker.** Every eligible ask is held; the parent is the only filter. That makes
the skill edits mandatory rather than optional, because the shipped contract currently tells a child
something that will no longer be true.

- **Worker clause 5 is rewritten in place** (not a new clause, so the count word and the cross-corpus
  count scans at `worker-skill.test.ts:105-134` stay untouched). Today it promises the ask "reaches a
  human who can act on it"; `SKILL.md:194-197` repeats it. Under this lane it may be ruled by a parent.
  Leaving the bytes unchanged is not a saved cost — it ships a test-pinned falsehood at the moment the
  child is relying on it.
- **A parent clause is added to BOTH skills**, said twice deliberately — the precedent is the
  branch-discipline sentence, which is in both "because a skill reaches a home only once its installer
  has run there". R3 makes a worker the common parent, so a coordinator-only clause leaves the common
  case unwritten. It carries R2's boundary (rule from the artifacts; escalate a new decision), names
  `POST /api/asks/:id/answer` as the one route allowed to answer, and forbids typing into a child's
  pane directly — the shape of coordinator clause 9, which forbids `/clear` by naming the one route
  allowed to write it.
- Budget the worker-side edits explicitly: CONTRACT literal, `SKILL.md` numbering, its two prose
  counts, `README.md`, `CLAUDE.md`.
- **The coordinator suite has no clause-count guard** — its CONTRACT loop is a subset check, so an
  11th clause goes unnoticed. Ship that guard with the new clause, measured red before and after
  (`worker-skill.test.ts:94-135` is the model).

### 6.1 What a parent can actually see

Confirmed exhaustively: **no route, ws feed, or ccd verb lets one session read another's transcript.**
`GET /ws/session/:id` is a WebSocket (ccrc-api is REST-only, no passthrough), is not in `gate.ts`'s
EXEMPT map, and is not one of `ccrc-api`'s 18 closed `ROUTES` rows. `GET /api/fleet`'s `askSummary` is
an 80-char, first-question-only, no-options clip and is itself unreachable to a fleet caller.

So **the ask row is the parent's entire evidentiary surface**, and R2 means the parent rules from *its
own* artifacts — spec, plan, ledger, branch, its prior rulings — plus the question text. It cannot see
the child's reasoning. The parent clause must say so, or it will imply a capability that does not
exist.

One fork the plan must settle: populate the row from `hookstate.ask` (cheap; no `preview` field ever,
and lost entirely under the hook's 64KB whole-file cap) or re-derive via `readPendingAsk`
(full-fidelity, currently wired only inside one WS connection and needing new plumbing to run against
an arbitrary session id).

---

## 7. Timing

| case | latency to the parent | source |
|---|---|---|
| parent idle well past the quiet floor | **4–14s** | sweep granularity + `sendPrompt`'s own sleeps |
| parent that just went idle | **~55–70s** | `MAIL_QUIET_MS` 60s, measured from `statusUpdatedAt` |
| second of two simultaneous children | up to ~2 min later | one message per session per sweep + cooldown |

`MAIL_COOLDOWN_MS` is measured since that recipient's own last successful injection and lives in an
in-memory map (`watch.ts:518`), so it does not bite a parent that has been asleep. The binding
constraint is `MAIL_QUIET_MS`, not the cooldown.

**GRACE must therefore exceed ~70s to give a just-idle parent any chance at all**, and every second
above that is latency the operator pays on questions the parent declines. This is why the decline verb
exists: the window is a **ceiling, not a tax**. `POST /api/asks/:id/release` fires the push at once, so
only a parent that has genuinely gone quiet pays the full window. The initial value should be measured
on the live fleet rather than picked here; ~90-120s is the defensible starting point.

---

## 8. What ships alongside (all verified against the guard suites)

1. **`box-token-census.test.ts`'s `SCAN_RE` cannot match hyphenated number words.** The tree stands at
   `COORD_LANES=18` / `ALL_LANES=19`; three new lanes make it twenty-one/twenty-two, and the scanner
   reads "twenty-one" as "twenty" — so it reds against prose that is word-for-word correct, at six
   order-pinned sites (`README.md`, `gate.ts` ×2, `auth-gate.test.ts`, and project `CLAUDE.md` by a
   derived name check). **Land the `SCAN_RE` fix as its own commit first**, matching hyphenated forms
   first as the file's own note prescribes (`:143-144`); it is provably a no-op today because no
   scanned passage contains one.
2. **Route placement is over-determined and needs a ruling before the plan.**
   `coordinator-skill.test.ts:266` requires every route registered in `coord/routes.ts` to be named in
   the *coordinator's* corpus — but by R3 the caller is usually a worker, and the worker corpus has no
   route parity at all. Recommended: widen `COORD_PREFIXES` to include `/api/asks`, give the
   coordinator suite's EXEMPT a fifth class with its own argument ("a route every parent uses, whose
   home corpus is the worker's"), and give the worker corpus the route parity it lacks so the routes
   are pinned somewhere.
3. **A fourth typed refusal union.** `answerAsk`'s nine errors become quoted kebab literals inside
   `server/src/coord`, which `mail-routes.test.ts:431` scans in both directions against exactly two
   unions. Declare `AskRefuseCode` / `ASK_REFUSE_CODES` in `shared/api.ts`, derived
   (`Object.keys`), widen the scanner to accept it with the same both-directions pin, and re-home
   `AskResult`'s error union there so both sides declare the vocabulary once — the D-1438 `ReadFailure`
   precedent. Adding these to `NOT_CODES` instead would make the scanner's doctrine a lie at the one
   place a client switches on the token.
4. **Caller attribution, not just the box token.** The box token is one shared secret per box, identical
   for every session on the fleet host, and the existing `POST /api/sessions/:id/ask` carries **zero**
   caller-identity check (`knownId` plus body shape). "The caller is this child's derived parent" has
   no home except the new route, and needs the mail-ingress shape: box token **plus** `fromId`/`fromUuid`
   checked against the registry (`coord/routes.ts:543-576`).
5. **`GET /api/asks` needs the D-149 either-credential shape** — a fleet parent reads it with the box
   token, the PWA reads it with a cookie. Five shipped GETs already do this; none is a write yet, but
   `sessionAuth` and `checkMailToken` are both verb-agnostic.
6. **Guards the wave owes** (none of these red on their own): a `describe('AskState')` in
   `single-definition.test.ts`; an `isAskState` with an `unknown` arm read back by the store, so a
   deploy rollback meets a token it does not know (`schema.ts:41-45`); a new `UNRECOVERABLE` entry and
   count bump in `reconstruction-drill.test.ts`; and the coordinator clause-count guard from §6.
7. **Stale detection rides `dialog_cleared`**, which `detectDialogs` already emits ±2s deterministically
   for every disappearance mechanism because it reads only what is painted (`watch.ts:3292-3296`). Its
   one consumer today is the per-session WS stream; do not invent a second poller. **Do not** use
   hookstate freshness as the staleness signal — `cmd_swap` does not rotate the uuid, so the identity
   gate is blind to exactly the case this needs to catch, and the file still reads `waiting` behind a
   pane that is gone.
8. **`cmd_swap` is the one live-pane-destroying operation not serialized** against `answerAsk`'s
   capture-then-send window. Route it through the same per-session `KeyedQueue`, and make `answerAsk`
   check `sendKey`'s boolean so a swap race reports a refusal rather than `{ok:true}`.
9. **AGENT-FIRST.** Anything touching `ccd/`, `session-hook.sh` or either skill ships to the fleet host
   before the server. The child side needs no ccd change at all, which is what keeps this ordering
   cheap; Case B (§3.2) is the part that does not.

## 9. Deviations

This design owes roughly eight ledger entries — the `SCAN_RE` fix, the `asks` D8 ruling, the route
placement ruling and whichever guard is widened to hold it, the fourth refusal vocabulary, the instance
guard, the row-as-mutex ruling, the record-at-hold-time ruling, and the swap serialization. **The
implementation plan mints them as one contiguous block via `POST /api/ledger/deviations`** and defines
them in the same act; no number is written here, because a number written without being issued seals
its own band forever.

## 10. Rejected, so nobody relitigates it

- **Child mails its question and sleeps.** §1 — F1 makes the answer undeliverable, F2 costs
  `README.md:52` and 25-100× latency, F3 gets the child compacted mid-question.
- **A stored `origin` / parent field.** §3 — redundant with `dec.actor`, stale across reclaim, and its
  default would stamp a permanent lie during the AGENT-FIRST window.
- **A hand-maintained eligibility carve-out for approvals.** §2.2 — it leaves multi-question,
  multi-select, free-text and blank-label open; `askActions` closes all five.
- **Holding the push by suppressing `raise()`.** §2.3-2.4 — `dialogIds` is stamped regardless, so the
  edge is spent and no later tick re-raises; and `pushOne` records and pushes in one act, so
  suppression deletes the record too.
- **A singular `{optionIndex}`.** §2.2 — commits an irrevocable one-of-N on a multi-select question.
- **An operator-only marker the child can set.** R7 — the parent always gets first refusal; the
  contract is made honest by editing it, not by carving an exception into it.
