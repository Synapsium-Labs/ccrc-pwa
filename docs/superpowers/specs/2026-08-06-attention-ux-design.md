# Attention UX — design spec (Orca imports, Build 2)

**Status:** approved for build (the operator ratified the whole item list on
2026-08-05: *"I've read the spec — we should do all of those items"*).

**Source of truth:** `docs/superpowers/research/2026-08-05-orca-analysis.md`
Tier-1 items 2 and 3, UX items 1, 2 (leapfrog half), 4 and 6 — plus the two
items Build 1 deferred into this one by name, and the send-race bug the
operator reported live during Build 1's probe.

**What Build 1 already gave us:** every fleet session carries `hookState`
(`working|waiting|done|null`), `askSummary` and `subagents` on the wire, and
`~/.cc-sessions/<id>.hookstate.json` carries the full structured ask envelope
(`{questions}` or `{approval}`). Build 2 is what the UI does with them.

---

## 1. The single bucket authority (`bucket` + `bucketSince`)

Orca's rule, quoted: sidebar counts come from the same builder as the cards
*"so the numbers always agree."* ccrc's failure mode today is exactly the one
that rule prevents — `sortFleet`'s bucket function, `groupFleet`'s `attention`
and `busy` counters and `SessionLine`'s own `attention`/`busy`/`state` locals
are **three independent re-derivations of the same idea**, already carrying
comments explaining how to keep them in agreement by hand.

**Decision: the bucket is computed once, server-side, and shipped on the wire.**
Two new additive `FleetSession` fields:

```ts
/** Which attention bucket this session belongs to. THE authority: the fleet
 *  screen's sections, its counts and the row's own state word all read this
 *  one field, so they cannot disagree. Computed in `fleet.ts` beside — never
 *  inside — the `status` derivation, which stays frozen (Build 1's rule:
 *  status must not learn to read hook state). */
bucket: 'attention' | 'working' | 'done' | 'idle' | 'cleanup' | 'archived' | 'dead';
/** Epoch ms this session ENTERED its current bucket, as evidenced by the
 *  underlying signal — never a watcher's memory of when it noticed. Null when
 *  no evidence exists. Drives the unseen watermark (§2). */
bucketSince: number | null;
```

### 1.1 Derivation (a pure function of one session's data)

Order matters; first match wins.

| # | Bucket | Condition | `bucketSince` |
|---|---|---|---|
| 1 | `cleanup` | `archivedAt !== null && pr?.phase === 'merged'` | `max(archivedAt * 1000, pr.mergedAt)` |
| 2 | `archived` | `archivedAt !== null` | `archivedAt * 1000` |
| 3 | `dead` | `status === 'dead'` | `statusUpdatedAt` |
| 4 | `attention` | `dialogPending \|\| hookState === 'waiting'` | hook `updatedAt` when the hook is the reason, else `statusUpdatedAt` |
| 5 | `working` | `status === 'busy'` | `statusUpdatedAt` |
| 6 | `done` | `hookState === 'done'` | hook `updatedAt` |
| 7 | `idle` | otherwise | `statusUpdatedAt` |

**The archived rows come FIRST, and that ordering is load-bearing.** `ws-archive`
stops the session, so an archived workspace's tmux session is gone and its
`status` is `dead` — testing `dead` first would route every single cleanup
candidate into the `dead` bucket and leave the leapfrog bucket permanently
empty. `archivedAt` is the more specific fact and outranks the liveness one.

**Why `bucketSince` is derived, not remembered.** A watcher-held
`Map<id, {bucket, since}>` would reset on every server restart and paint the
entire fleet as freshly-unseen the moment ccrc redeploys — which, given ccrc
deploys both halves in one push several times a day, would train the operator
to ignore the badge within a week. Every bucket above has a timestamp already
on the record that means "when this began", so the function needs no memory
and survives restarts exactly.

**Why `working` does NOT use the hook's `updatedAt`.** The hook rewrites
`updatedAt` on every `PostToolUse` — a busy session would report a
continuously-refreshed "since", i.e. permanently new. `statusUpdatedAt` is
when it actually became busy. (`waiting` and `done` are terminal for the turn:
no further events fire while they hold, so their `updatedAt` is stable and is
the honest episode start.)

**Why `done` requires hook evidence.** A hookless session that went busy→idle
gives us no proof a turn *finished* rather than never started; it lands in
`idle`, which is the truth. This also gives `done` a natural decay: Build 1's
30-minute freshness gate nulls `hookState`, so an unacknowledged `done` falls
back to `idle` instead of accumulating forever.

**Why `cleanup` takes the LATER of its two timestamps** (amended by PR E's
whole-branch review). Its condition is a conjunction, so the session enters the
bucket when the second conjunct lands. On the auto-archive path that is the
archive (sweepPr flips the phase, `archiveMerged` archives seconds later), and
`archivedAt` alone reads correctly. On the MANUAL path it inverts: archive at
T0 with the PR still open, open the session at T1 (which acks it), let the PR
merge at T2 — the session enters `cleanup` at T2 while `archivedAt` still says
T0, so `bucketSince > acks[id]` is `T0 > T1`, false, and the leapfrog bucket's
badge is dead in exactly the flow it exists for. `pr.mergedAt` is already on the
wire, and `max()` is still memory-free.

**`cleanup` is the leapfrog bucket** — the one the analysis says Orca
structurally cannot build, because their merge detection is decorative while
ours gates automation. It is populated only by ccd's own gh-verified
`pr.phase === 'merged'`, which is the same authority `sweepPr` already trusts
to archive.

### 1.2 What must NOT change

- `status` derivation stays frozen and hook-blind. Build 1 pinned this with a
  test asserting identical `status` with and without hookstate present; that
  test stays, and a second one asserts `bucket` is the only field that moved.
- `dialogPending` keeps its existing meaning and its existing OR of a fresh
  `hookState === 'waiting'`.
- The three client-side re-derivations are **deleted, not left in place**:
  `sortFleet`'s `bucket()`, `groupFleet`'s `attention`/`busy` and
  `SessionLine`'s `attention`/`busy`/`state` all become reads of `s.bucket`.
  Leaving any one of them is the drift the field exists to end.

### 1.3 Cost of the `cleanup` bucket's card copy

The analysis's example card — *"merged #157, 1.2 GB reclaimable, audit clean"* —
has three claims with three different costs. `merged #157` and the byte count
are already on the wire (`pr.number`, `archivedBytes`, measured at archive
time). **`audit clean` is not, and must not be**: a fleet-wide `ws-audit` per
tick is a per-workspace shell-out, and the audit's whole purpose is to be read
by a human immediately before a destructive act. The card claims only what it
already knows; the audit runs on demand when the operator opens the actions
sheet, exactly as it does today. A card that said "audit clean" from a
90-second-old cached audit would be the same class of lie as claiming an
archive that was deferred.

---

## 2. The unseen ack watermark

Orca: one app-wide map, `acknowledged[key] < stateStartedAt` drives "needs your
eyes" on every surface in lockstep.

**Decision: client-side, per-device, in `localStorage`.** ccrc has no user
accounts and the server has no notion of a viewer; "seen" is a property of the
*person holding the phone*, not of the fleet. Storing it server-side would mean
the desktop marking the phone's badge read.

```ts
// pwa/src/lib/seen.ts
// localStorage key `ccrc:seen:v1` → Record<sessionId, ackAtEpochMs>
export function isUnseen(s: FleetSession, acks: Acks): boolean
export function ack(id: string, at: number): void     // writes through
export function prune(liveIds: Set<string>): void     // bounded growth
```

- **Unseen** = `bucketSince !== null && bucketSince > (acks[id] ?? 0)` **and**
  the bucket is one that wants a human: `attention`, `done`, `cleanup`. A
  `working` or `idle` session is never badged — nothing is being asked of you.
- **Ack fires** when the session screen is opened (`/s/<id>` mount) and on an
  explicit "mark all seen" affordance on a bucket header. Opening a session is
  the honest ack: you looked at it.
- **Prune** on every fleet snapshot, against the ids actually present, so the
  map cannot grow past the fleet.
- **One writer.** Every surface (bucket header counts, row badge, the bell)
  reads the same `isUnseen`; none re-implements the comparison. This is §1's
  rule applied to the client half.

---

## 3. Notification seq + epoch watermark (one atomic JSON value)

Orca's torn-write reasoning, which the analysis calls airtight: *a seq is
meaningless without the counter's lifetime (epoch); written separately, a death
between writes forges a valid-looking pair that silently drops real
notifications.*

**Server side** — `server/src/notifylog.ts`:

- A bounded in-memory ring of the notification events the server has fired
  (`{seq, at, kind, sessionId, title, body}`), cap 200, oldest evicted.
- `{epoch, seq}` persisted as **one JSON object in one file**, written
  tmp + `rename` (the identical pattern `push.ts` already uses for the
  subscription store). Never two writes, never two files.
- `epoch` is minted fresh whenever the file is missing, unreadable or
  malformed — i.e. whenever the counter's lifetime cannot be proven continuous.
  A new epoch is not an error path; it is the signal that tells clients to stop
  trusting their seq.
- `catchUp(sinceEpoch, sinceSeq)` returns either
  `{ epoch, seq, events }` (the events strictly after `sinceSeq`), or
  `{ epoch, seq, resync: true }` when the epoch differs **or** when
  `sinceSeq` is older than the ring's oldest retained event — because in both
  cases the honest answer is "I cannot prove you saw everything".

**Client side** — the PWA stores its `{epoch, seq}` as one `localStorage`
value and sends it on fleet-WS connect. `resync: true` means: drop the local
watermark, take the fresh snapshot as ground truth, badge nothing retroactively
(a fabricated badge is worse than a missed one — the fleet snapshot itself
still shows every session that currently wants you).

**Which events enter the log.** Exactly the three the server already pushes:
turn-finished (busy→idle), dialog/ask raised, and merged+archived. The log is a
record of *what was notified*, so it can never claim more than push did.

---

## 4. Push-actionable asks (the leapfrog Orca cannot follow)

They have no push at all. We answer the question from the notification.

### 4.1 The answer route

`POST /api/sessions/:id/ask` — new, and deliberately **not** an extension of
`/dialog`, which is pane-coordinate-based and correctly stays that way.

```jsonc
{ "askKey": "<opaque>", "optionIndexes": [0] }   // 1..N indexes, 0-based
```

Server-side gate, fail-shut, in this order:

1. The session is known and live.
2. A **fresh** hookstate exists with `state === 'waiting'` and an
   `ask.questions` envelope (an `{approval}` envelope is refused here — approvals
   go through the existing dialog path where the pane rows are the truth).
3. `askKey` equals the key recomputed from the *current* envelope. This is the
   server-side twin of the correspondence gate PR C added to `DialogSheet`:
   the client answers the question it was shown, or it does not answer.
   Key = a stable digest of the first question's `question` + its option
   labels in order — content, not position, so a re-render can't forge it.
4. Every index is in range for that question's options.
5. `multiSelect` agreement: more than one index requires
   `questions[0].multiSelect === true`; a single index is always allowed.

Refusals return 409 with a named reason (`stale-ask`, `ask-mismatch`,
`not-waiting`, `range`, `multiselect`) — Orca's "force is not a scalar" lesson
(analysis Tier-1 #4): each distinct hazard gets its own named refusal, and the
sentence the UI shows is co-located with the classifier that decided it.

**Injection**: single index → the digit alone (Build 1's live probe proved a
digit both selects *and* confirms). Multiple indexes → each digit, then Enter.
Multi-select is this route's acceptance test.

### 4.2 The send-race fix (operator-reported, Build 1)

> *"it didn't press 'enter' on the prompt, so it's typed up but not sent, a UI
> issue I also encounter regularly"*

**Measured before speccing, and the obvious fix is the wrong one.**
`inject/send.ts` *already* implements settle-before-submit, and more
thoroughly than Orca's readiness signal: it polls up to 12 × 200 ms for the
box to echo the text before pressing Enter at all, then presses Enter,
proves *our text left the box* (`submitted()` — emptiness alone is wrong,
a busy session swaps the row for a queue hint), presses a second Enter if it
didn't, and only then claims success. Adding a settle would be re-adding what
is there.

The operator's symptom is the path where all of that has already run and
**both** Enters were swallowed: `sendPrompt` returns `enter-ignored`, having
deliberately left the typed text in the box (a lost Enter is recoverable, a
misplaced one is not — that reasoning stands). The PWA then shows
*"Typed it, but the session didn't accept it — open the terminal to check."*
So the text is verified present, the server knows it, and we send the operator
to a terminal to press one key.

**Decision: give that dead end an affordance instead of a sentence** —
Orca's Tier-1 #4 lesson exactly ("a message that tells the user to force-delete
while the UI hides the button is the same dead end"). A new
`POST /api/sessions/:id/submit` presses one Enter and verifies with the same
`submitted()` machinery, refusing when the box is empty (`nothing-to-submit`)
or a menu owns the keyboard (`dialog-open`). The `enter-ignored` toast gains a
**"Send it"** action wired to it. The ask route (§4.1) reuses the identical
proven machinery rather than growing its own.

**Deliberately NOT auto-retrying server-side.** A third blind Enter is what a
loop would do, and the two that already fired prove the pane isn't accepting
keystrokes for a reason we cannot see. A human tap carries the information a
retry loop doesn't: they looked.

### 4.3 Service worker actions

`push-sw.js` gains `actions[]` when the payload carries them (cap 2 — the
platform ceiling on Android, and the reason the payload sends the first two
option labels plus the deep-link fallback for everything else). A
`notificationclick` carrying `event.action` POSTs to §4.1 same-origin, then:

- **200** → replace the notification with a confirmation (`"Answered: Blue"`).
- **409** → replace it with the refusal's own sentence and deep-link to the
  session, because the state moved and the human should look.
- **network failure** → deep-link, notification stays. Never silently drop.

The SW never guesses an index from a label: the payload carries
`{label, index, askKey}` per action, minted by the same code that computed the
key.

---

## 5. State vocabulary — two glyphs, and `done` gets a check

Orca: one glyph for *who*, one for *what state*, "scannable instead of fused";
`done` gets a check so it can't be confused with grey `idle`.

ccrc already has the *who* half — the account name in its account hue,
`↗` when running away from its pin. What is missing is a state glyph distinct
from the lamp's colour alone, which is the exact confusion the rule names:
today `done` and `idle` are both "not amber, not busy".

| Bucket | Glyph | Word |
|---|---|---|
| `attention` | ● amber | `waiting` |
| `working` | ◐ | `working` |
| `done` | ✓ | `done` |
| `idle` | ○ | `idle` |
| `cleanup` | ♻ | `merged` |
| `dead` | ✕ | `exited` |

Every one is rendered by `StatusDot` from `s.bucket` — a seventh place to
re-derive state is precisely what §1 forbids. Colour alone never carries the
distinction (the contrast suite already enforces this class of rule).

**Notification copy discipline** (Orca's, adopted verbatim in intent):

- Project context in the title **only when more than one project is active** —
  the server knows the whole fleet at push time, so it can tell.
- **Nothing fires for the session the operator is currently looking at.** The
  PWA reports its visible session id over the existing fleet WS; while a client
  is connected *and* reports that id, pushes for it are suppressed. If no
  client is connected, everything fires.
- Stale snapshots stay suppressed by the existing `dialog.id`-changed gate.

---

## 6. Subagent rows

Build 1 already ships `subagents` on the wire and a `⑂ N` tally on the row.
Orca renders indented child rows with their own state. Ours have no state of
their own to show (Claude's `SubagentStart/Stop` gives us name + start time),
so the honest version is: **tapping the tally expands indented rows showing
each subagent's name and elapsed time**, and nothing else. No invented state,
no PTY, capped at the hook's own 32.

---

## 7. Carried from Build 1

- **I2 — free-text / preview restoration in `DialogSheet`.** Decision: the
  envelope render shows each option's `description` under its label (the
  preview Orca has and our scrape never had — it is in the envelope already and
  we were dropping it). A question with **no** options is free-text: the sheet
  renders the question, no rows, and the "Open terminal to answer" CTA, which
  is the honest affordance — typing free text blind is the send-race with worse
  consequences.
- **The blind-digit route** is §4.1 above; multi-select is its acceptance test.

---

## Non-goals

- No SQLite. The trigger condition recorded in the analysis (agent-to-agent
  orchestration) belongs to Build 7, not here.
- No transcript rendering — that is Build 4, and this spec's `askSummary`
  deliberately stays the hook's one line.
- No terminal-fidelity work (analysis UX #3): it is renderer-side and only
  earns its keep the day two viewers watch one session.
- No fleet-wide `ws-audit` (§1.3), and **no destructive verb ever runs from a
  card** — the `cleanup` bucket surfaces candidates; the operator retires them
  through the existing sheet, which keeps the consent ceremony ccrc leads on.
