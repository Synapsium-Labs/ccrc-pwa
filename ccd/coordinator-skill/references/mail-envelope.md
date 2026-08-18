# The envelope

Your session is never typed a message directly — only a tiny one-line nudge
pointing at `GET /api/mail?to=<you>` (`references/wave-lifecycle.md` §3). Each
listed row carries a `deliveryId` — use THAT, never the row's `id`
(`references/wave-lifecycle.md` §3, re-opened D-41) — for
`GET /api/mail/<deliveryId>`, which is what returns one outstanding delivery:
a fenced, self-describing block. You need no tooling to act on it; everything
is on the face of it. (The `id:` field inside the fenced block below IS the
delivery id already — `renderEnvelope` has always published the delivery id
there; the mail/delivery id ambiguity is only a listing-row concern.)

<!-- BEGIN renderEnvelope — paste the real output here (Step 6) -->

````text
```ccrc-mail
id: 7
from: ccrc-pwa-clear-cove
to: ccrc-pwa-still-water
run: 3 (program:build4-transcript-surface wave 3)
kind: status
subject: wave-done
artifacts:
  /w/clear-cove/docs/superpowers/programs/build4-transcript-surface.md
ack: POST /api/mail/7/ack with header x-ccrc-mail-token (the value in
  ~/.cc-secrets/ccrc-mail.token) and body {"fromId":"<your ccd id>","fromUuid":"<your uuid>"}.
  Until you ack, this message is redelivered on later sweeps, up to a bounded number of
  attempts — after that the lane gives up and marks it undeliverable. Ack it promptly.
--
Wave 3 is on the branch. Handoff commit is the ledger update; PR #591 is green.
```
````

**Ack before you act.** `POST /api/mail/<deliveryId>/ack`, body `{"fromId":…,"fromUuid":…}`
(`references/wave-lifecycle.md` §3). Until then the lane replays this message
verbatim on later sweeps — but not forever: past a bounded number of replay
attempts, the lane gives up and marks the delivery undeliverable. If you see
the SAME `id` injected several times, that is not a bug to ignore — ack it (or
answer it) now, rather than assuming a fresh copy will keep arriving. A
delivery the lane gave up on this way still shows up on `GET
/api/mail?to=<your id>` (`state: "rejected"`) — it was never acked and never
acted on, so it stays visible there rather than silently disappearing.

**Artifacts are paths, never payloads.** Read the file; do not expect its
contents in the body. The path above is **absolute**, because it is quoting
`renderEnvelope`'s literal output for a fixture message a WORKER already
sent — the ingress (`POST /api/mail`) refuses any relative `artifacts` entry
`bad-kind`, so no envelope with a relative path could ever exist here. When
THIS session sends mail of its own (`POST /api/mail`, `references/wave-
lifecycle.md` §3), its own `artifacts` entries must be absolute paths too.

**`to:` is always the resolved recipient.** The fixture above shows
`ccrc-pwa-still-water`, a concrete session id — never the literal role name
`coordinator`, even when the mail was addressed that way (`toId:"coordinator"`
on the sending side): the ingress resolves the role to whichever session
actually holds the program's coordinator run (`resolveCoordinator`) before
this envelope is ever rendered, and stores the rendered bytes. Reading `to:`
tells you who this envelope was actually delivered to, not the role the
sender named.

## When YOUR message is the one that cannot land

Everything above is about mail addressed to you. This section is the other
direction: you sent something and the lane cannot hand it over.

`GET /api/mail` rows now carry two fields that used to exist only in the
database:

- `attempts` — how many send FAILURES this **delivery** has recorded, which is
  exactly what the ceiling below counts. A back-off the lane declines to charge
  for does not move it.
- `lastError` — how the last attempt failed. **Raw text**, never validated on
  the way in: four writers put four different kinds of thing there, one of them
  a whole English sentence. Match the one value below; do not build a table off
  it and do not show it to anyone as if it were written for them.

### `lastError: "draft-present"` — the recipient's input box is occupied

The worker has unsent text sitting in its Claude Code input box, so the lane
refuses to type over it. It backs off and retries; it does **not** give up
immediately. You will see `attempts` climb on every tick.

The budget is **6 attempts**, and it applies only to a delivery that has never
been delivered at all. At the sixth the lane parks it `state: "rejected"` and
stops. That is deliberate — a message that can never land should not retry for
the life of the box — but a park means your brief was never read.

**One failure parks on the FIRST attempt, not the sixth:** `enter-ignored`,
where the lane typed your message into a never-delivered row's box and the
session swallowed both Enters. The text is sitting there whole, so re-injecting
would type the entire envelope a second time underneath the first. Do not wait
for a count to climb on that one.

What to do, in order:

1. **Look at the worker's own screen** in the PWA. Its mail strip names the
   block, with the attempt and the ceiling. What has to change is the box —
   the worker's own input box, the one the delivery lane types into, which is
   **not** the composer you type into on that screen. Nothing you can do to the
   mail row fixes it.
2. **If the text in the box is the worker's own half-typed message**, it is
   theirs. Ask them to send or discard it. Do not replace it.
3. **If the box holds a stranded `/clear`**, the lane may clear that one itself
   on the next attempt — but only where it can **prove** the `/clear` is its
   own: a dispatch of this run typed it and had it swallowed, the box still
   holds nothing but that single line, and **no message has landed in that box
   since**. That last one is what spends the proof: a delivery that lands is
   how the lane knows the box it had proof about was emptied, so the first
   message through clears the wedge and every one after it is refused like any
   other draft. The characters alone prove nothing,
   because they are four an operator plausibly types and leaves sitting, so a
   `/clear` with no such record behind it is treated as the operator's and
   refused. Assume nothing will be cleared for you; check the screen.
4. **If the delivery has already parked**, send the message again with
   `POST /api/mail` once the box is clear. The park is terminal for that
   delivery, not for the conversation: the mail row is untouched and nothing you
   said is lost.

You do not have to poll for any of this. The first `draft-present` back-off and
the park each raise **one** notification addressed to you, the sender — the
first one only, not one per tick, because the tray is not a ticker. What stays
live across every back-off is `attempts` on the delivery row.

### A queued brief is not a delivered brief

`POST /api/runs/:id/dispatch` answers with `briefQueued`, and with `clearError`
when there is one to report.

- `briefQueued: false` means **no brief was queued at all.** It is `true` when
  the wave was not resumed, or when its `/clear` actually verified; so on a
  **resumed** wave whose `/clear` was refused it is false, by design — a brief
  landing in an un-cleared context is worse than no brief. `clearError` names
  the refusal, and is present on the response **only** when the clear failed;
  its absence means there was nothing to report, not that it was empty.
- `briefQueued: true` means the brief is **in the delivery lane**, not that the
  worker has it. It still has to survive the recipient's input box. Treat a wave
  as briefed only when the worker acks the mail.

A wave that has gone quiet after a dispatch that answered `ok` is very often
this: the brief is queued, the box is occupied, and the worker has been sitting
with nothing to do. Read `attempts` and `lastError` on the delivery before
assuming the worker is stuck on the work.
