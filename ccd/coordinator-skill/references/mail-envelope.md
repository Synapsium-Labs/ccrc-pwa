# The envelope

Mail is injected into your session as a fenced, self-describing block. You need
no tooling to act on it; everything is on the face of it.

<!-- BEGIN renderEnvelope — paste the real output here (Step 6) -->

````text
```ccrc-mail
id: 7
from: ccrc-pwa-clear-cove
to: coordinator
run: 3 (program:build4-transcript-surface wave 3)
kind: status
subject: wave-done
artifacts:
  docs/superpowers/programs/build4-transcript-surface.md
ack: POST /api/mail/7/ack with header x-ccrc-mail-token (the value in
  ~/.cc-secrets/ccrc-mail.token) and body {"fromId":"<your ccd id>","fromUuid":"<your uuid>"}.
  Until you ack, this message will be delivered to you again.
--
Wave 3 is on the branch. Handoff commit is the ledger update; PR #591 is green.
```
````

**Ack before you act.** `POST /api/mail/:id/ack`. Until then the lane replays
this message verbatim on later sweeps.

**Artifacts are paths, never payloads.** Read the file; do not expect its
contents in the body.
