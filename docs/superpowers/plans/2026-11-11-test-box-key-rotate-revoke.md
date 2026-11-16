# The test box access key can be rotated and revoked from the card

- **D-8337 (2026-11-11)** — test box access key Rotate and Revoke: `ccrc testbox-admin key-rotate` puts a new key on the box with the old one (append, log in with the new one, switch, remove the old line), and `key-revoke` takes the pairing apart as Disconnect does and deletes the key pair; both behind the step-up, each a ledger act, each one tap then confirm on the connected card.

## Why

#2436 asks for **Rotate** and **Revoke** on the card. Today ccrc makes its own ssh key pair for the test box (`key`, D-8166
C1), the operator adds its public line to the box, and Disconnect removes that line but keeps the pair (so the next Connect
shows the same line). There was no way to replace a key that may have leaked, or to destroy it, without a shell on the fleet
host.

## Change

- **Contract** (`shared/testbox-admin.ts`): two subs, `key-rotate` and `key-revoke`, no fields, `stepUp: true`, short; two
  ledger acts of the same names; four closed codes: `new-key-refused` (Rotate changed nothing: the box did not take the new
  key, its line was taken out again and the old key still works), `old-line-kept` (Rotate is done, the old key's line could not
  be removed), `revoked-box-skipped` and `revoked-unpair-failed` (Revoke deleted the key and forgot the box, and its box side
  was not reached or did not finish). `TESTBOX_LINE_CODES` names the three codes whose refusal carries the PUBLIC key words the
  operator removes by hand; the route passes that `line` through its one-printable-line grammar and nothing else.
- **The verb** (`ccd/ccrc-testbox-admin`). `key-rotate`, under the short lock, needs a recorded connection, ccrc's own key
  pair and a pinned host key the box still presents. It makes the new pair in a private temp directory, then:
  1. appends the new line (same `from=` rule as `key`) to the login user's `authorized_keys` with the OLD key, by a temp and
     a rename, once only;
  2. logs in with the NEW key only (`IdentitiesOnly`, the same sudo prefix as every act);
  3. on failure takes the new line out again with the old key, deletes the new pair and answers `new-key-refused`: the old
     key stays in place and still works;
  4. on success switches the stored pair (two renames, with TERM, INT and HUP ignored by the verb's own shell between them,
     so its exit chain cannot delete the temp directory halfway and leave the new private half with the old public half);
  5. with the new key, removes every line carrying ccrc's comment that is not the new key (so a line left by an earlier
     interrupted rotate goes too) and every line holding the old key's base64, whatever its comment; ccrc's comment is
     read after trailing spaces, tabs and a CR are trimmed, since sshd takes a pasted CRLF line. A failure here answers
     `old-line-kept` with the old key's public words;
  6. logs in with the OLD key alone: a box that still takes it (a line in another AuthorizedKeysFile) answers
     `old-line-kept` too, never ok.
  `key-revoke` runs Disconnect's body (switch off, the box's unpair, ccrc's access lines out, the fleet side cleaned, the
  connection forgotten) and then deletes the key pair whatever the box did. Disconnect's removal takes out every ccrc line
  (trimmed as above) and every line holding ccrc's own key; for key-revoke it then checks that the key no longer logs in.
  When the box side was skipped or did not finish, or the key still logs in, it answers `revoked-box-skipped` /
  `revoked-unpair-failed` with the revoked key's public words, and the card tells the operator to remove EVERY line ending
  in `ccrc-testbox-admin` (an interrupted act may have left another key's), not only the one shown.
  `key`, `key-rotate` and `key-revoke`, once they hold the lock, remove any `key.*` or `pushkey.*` temp directory in
  `~/.ccrc`: a SIGKILL, an OOM kill or a hard reset skips the exit chain that would, and a rotate killed after its append
  leaves a private key the box already trusts. Only under the lock, so no live act's directory is touched.
- **Route** (`server/src/testboxAdmin.ts`): `resultOf` gives `key-rotate` its new public line; `decisionOf` lets a
  `TESTBOX_LINE_CODES` refusal carry `line`. The ledger row is the route's usual short-act row (closed act, outcome and code;
  no key material: the table has no field that could take it).
- **Card**: the connected card has **Rotate key** and **Revoke key**, each opening the one confirm sheet (a sheet that says
  what changes, the step-up inside it, Confirm and Cancel). A line the operator must remove by hand is shown by the section,
  above the card, with Copy and Dismiss, so it survives the card switching to the connect flow after Revoke.

## Never

The private half never leaves the fleet host: it is made by `ssh-keygen` into a 0700 temp directory, renamed into place, and
never printed, logged, put in the state file, an answer, a ledger row or a websocket frame. Only public key words cross.

## Deviations found

- The task named the rotate path `key --rotate`. It is a sub of its own, `key-rotate` (and `key-revoke` beside it): `key`'s
  `--address` is required, the sub table has no conditional requirement, and a row is how the table grows (CLAUDE.md:
  extend through tables). Disconnect's `--replace` precedent changes only the ledger act, not what the sub needs.
- No new cap word: an older fleet verb answers the new subs as a usage error, which the route reads as `fleetFailed`. The
  fleet and the server move together on a rollout.
- Revoke is offered on the connected card only. A pair Disconnect kept is revoked by connecting and revoking, or (later) a
  control on the connect flow; the status does not yet say whether a key exists.
- The worst case of a rotate is five bounded waits for the box (the host key scan, the append, the new login, the old
  line's removal, the old key's refused login) at ten seconds each outside a unit: inside the agent's sixty-second bound for
  a short sub. The fifth runs only after the removal reached the box.
