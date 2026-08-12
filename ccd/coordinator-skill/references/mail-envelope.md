# The envelope

Your session is never typed a message directly — only a tiny one-line nudge
pointing at `GET /api/mail?to=<you>` (`references/wave-lifecycle.md` §3). This
is what `GET /api/mail/:id` returns for one outstanding delivery: a fenced,
self-describing block. You need no tooling to act on it; everything is on the
face of it.

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

**Ack before you act.** `POST /api/mail/:id/ack`, body `{"fromId":…,"fromUuid":…}`
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
