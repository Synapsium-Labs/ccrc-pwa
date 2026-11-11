# The wave lifecycle: step 3, read mail

One part of the wave lifecycle. `wave-lifecycle.md` lists every part.

## 3 — Read mail

What lands in your session is NOT the message — it is a tiny one-line nudge
that points at it. The nudge opens with the same 24 characters every time and
carries no delivery id itself: one nudge means "you have outstanding mail",
not "here is one message". Whichever form it takes, read your mail one way:

```bash
"$HOME/.local/bin/ccrc-api" mail inbox
```

Run `mail inbox` bare, by that full path: no pipe, no redirect, no `head` or
`tail`. It prints every delivery you can still ack, oldest first, each in the
envelope shape of `references/mail-envelope.md` under its `delivery:` id and
with no `ack:` lines, then acks each entry right after printing it, through
the ack route below with your own pane's `fromId` and `fromUuid`. What it
printed is acked, so act on it. Its stdout is plain text, not JSON. A piped or
`/dev/null` run prints everything and acks nothing, and says so on its first
and last lines. A redirect to a file still acks what it wrote, so do not read
your mail into a file. After each entry it says `inbox: acked delivery <n>`, or
why it did not ack (`was already acked`; `was closed before this ack`, nothing
owed; `is NOT acked`, shown again next time); its footer lists every delivery
it acked, for `ccrc-api mail fetch <delivery>` if their text did not reach you,
and says when more remain (run it again) or when abandoned deliveries are not
shown (`mail list --to <your id>` lists them). It reads the server's
`GET /api/mail/inbox?fromId=<your id>&fromUuid=<your uuid>`, which writes
nothing: every ack is the client's, one per printed entry.

The nudge's older form names the list ("`ccrc-mail: you have new mail. List
(GET /api/mail?to=<you>); per row use its deliveryId, NOT id…`"); read with the
inbox all the same. **The fallback** is the three steps below: `mail list`,
then `mail fetch` and `mail ack` per row. Use them when the client answers
`the server did not serve the inbox` (the server predates it), and to read one
delivery again.

0. **List**: `GET /api/mail?to=<your session id>`. This returns only
   OUTSTANDING mail — `queued`/`delivered` (unacked), plus a delivery the lane
   gave up retrying before anyone acted on it (`state:"rejected"`,
   distinguishable by that field) — never a row you have already acked. Add
   `&all=1` to read the full history instead (every state, including
   `acked`), which is what you want for a human-facing "what happened"
   question, never for "what do I still owe an answer to" — reading history
   for the latter is how a wave gets dispatched twice (a stale copy of a
   `wave-done` you already acted on reads identically to new work unless you
   separately filter on `state`, which the unfiltered history does not do for
   you). **Each row carries two ids — `id` and `deliveryId` — and they are
   NOT interchangeable** (re-opened D-41): `id` is the message's own id, but
   `GET /api/mail/:id` and `POST /api/mail/:id/ack` below both key on the
   DELIVERY id. The two only happen to be numerically equal for a mail sent
   to exactly one recipient; a mail fanned out to several recipients gives
   each of you a different `deliveryId` for the SAME `id`. **Always use
   `deliveryId`** for the next two calls — using `id` fetches or acks a
   different worker's copy (or 404s) and leaves your own delivery to replay
   until the lane gives up on it.

For each outstanding row, with `:id` below filled in from its `deliveryId`
(never its `id` — see above):

1. `GET /api/mail/:id` to fetch the body — the envelope shape in
   `references/mail-envelope.md`, served verbatim (never re-rendered) from
   what was queued. Token-gated the same as every other call here; no
   `fromId`/`fromUuid` needed for this read.
2. `POST /api/mail/:id/ack` **before acting on it**, body
   `{"fromId":"<your id>","fromUuid":"<your uuid>"}` — the exact pair from
   "Learn who you are, first" ($id, $uuid). Anything else 400s `bad-kind`; a
   `fromUuid` that does not match `$REG/<your id>.uuid` 403s `stale-uuid` (the
   file this session's own `/clear` would rotate — re-read it if you have any
   doubt). Until you ack, the lane keeps re-injecting the nudge on later
   sweeps — the SAME nudge, not a growing pile of them — and the mail it
   points at is still there when you list again. This is bounded, not
   forever: past a bounded number of replay attempts the lane gives up and
   marks the delivery undeliverable (`state:"rejected"` — it stays visible on
   the list above, since it was never acked and never acted on). If you see
   the nudge fire several times for what looks like the same mail, that is a
   signal to ack (or act on) it now, not a promise it will keep arriving
   indefinitely.
3. Then act.

The inbox route answers in pages of at most 20 KiB of rendered, masked text
(`remaining` counts what a page left out, and the client says to run it again),
and a fetched envelope keeps its `ack:` lines for the fallback above.

**Sending mail of your own** — a rejection (§4), a question, a status
update — is `POST /api/mail`, body:

```json
{"fromId":"<your id>","fromUuid":"<your uuid>","toId":"<recipient id>",
 "runId":<run id or null>,"kind":"answer|question|status|finding|artifact",
 "subject":"<subject>","body":"<body>","artifacts":["<absolute path>", …]}
```

Same `fromId`/`fromUuid` pair as the ack, checked the same way. `artifacts`,
when given, must be **absolute paths** — the ingress refuses a relative one
`bad-kind` — because the recipient reads the file directly, from whatever
directory its own turn happens to be in, not from this session's.

**One `kind`/`subject` pair has a body SHAPE rather than free prose:** a
worker's `status`/`wave-done`, whose four fingerprint fields the coordinator
submits unchanged. The worked example is in §4 — a worker sent here by its own
skill should read that block before it writes its first done-claim.

**Addressing, and the one rule that keeps it boring.** A worker is addressed
either by its session id or as `toId:"worker"` with the run — the role resolves to
whatever session that run currently names, which is what makes a replacement
reachable without anyone re-typing an id. So carry the `runId` on every mail you
send, whichever role you address: with it, `coordinator` resolves off that run's
own claim regardless of programme state and `worker` resolves off its `sessionId`;
without it, `coordinator` falls back to the single active programme and a `worker`
mail with no `runId` is refused `unknown-recipient`. One habit, no asymmetry to
remember. Reading a programme's whole lane is `GET /api/mail?program=<slug>&all=1`
— without `&all=1` it answers only what is still outstanding, exactly as `?to=`
does above — and its records are `GET /api/feed?program=<slug>`, which is always
the full archive with no outstanding/all split of its own; together they are the
filters that make a cross-repo programme legible from one call instead of two per
repo.
