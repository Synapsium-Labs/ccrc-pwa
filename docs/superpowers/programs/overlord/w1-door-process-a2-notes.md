# Overlord W1, door process A2: notes for the ledger

What door process A2 (plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-door-process.md`, Tasks 4 to 6) found while
building, for the coordinator to fold into the programme ledger. Each departure is named by a plain-words slug; no number
is taken here.

## Departures

- **`door-process-finds-identity-from-the-pane`**: the coordinator measured on the fleet's build that Claude Code hands a
  stdio tool server the parent's whole environment (`TMUX_PANE` and `TMUX` among it), not the MCP SDK's six-name default.
  So the door process runs `ccrc-api` with its inherited environment, `ccrc-api` derives the pane's identity as it always
  does, and `mcp.json`'s `env` carries only the nonce, the session id, the cache directory and the client's path. If a
  later build stops passing it, `whoami` fails and the process refuses every call: it fails closed.
- **`restart-of-a-dead-door-process-unmeasured`** (Task 5 Step 5, question 7): whether Claude Code restarts a dead stdio
  tool server is not measured. The session hook refused this worker's scratch run of the pinned build (its build
  category: the command named the launcher); it was reported and not retried. The coordinator's own probe reached the
  server's start and stopped at sign-in before any call. It is left to B1's measurements. A dead door process means no
  doors until the session's next start.
- **`spawn-does-not-check-the-client`**: `_door_spawn` writes the installed client's path (`~/.local/bin/ccrc-api`) into the
  config without checking that it exists. The door process's start (`whoami`) is the check, and it fails closed; a check at
  the spawn would have refused every surfaced spawn in the suites that build a fixture HOME without the client.
- **`program-beside-the-body`**: `_door_spawn` finds the program beside ccd's body (`${BASH_SOURCE[0]}`'s directory) in both
  layouts: `ccd/door-process.mjs` in a source checkout, `~/.local/libexec/ccrc/door-process.mjs` installed. That is the
  plan's two places, read as one rule.
- **`umask-is-the-mode-guard`**: the config is written under `umask 077` with no `chmod` after it, so the umask is the one
  guard of its mode, and removing it reds the mode case (the plan's mutation). The temp file is written with noclobber
  after a removal, so a link planted at `mcp.json.tmp` is never written through (a case). The two directories are
  `chmod 700`ed, because `mkdir -p` keeps the mode of a directory that already stood.
- **`program-in-the-library-half`**: the entry installer publishes the program as a third file of the library half, after
  `shared/redact-cli.mjs` and before the libraries and the body, staged in the libexec directory (slot 1, which nothing else
  uses there), and renders its pin through the redactor's one-placeholder rule. A run that fails after the program moved and
  before the body is the half's failure: the old body pins the old program, so a surfaced spawn refuses until a re-run
  converges, and the failure names `door-process.mjs` among what was renamed. "A run that fails between them leaves neither
  changed" is not what any half file does; the plan's intent (never a body pinning a program it cannot verify) holds.
- **`program-pin-carve-out-retired`**: `ccd-install-stamp.test.ts` set the program's pin aside as A1's one unrendered pin;
  the carve-out is gone now that the installer renders it.
- **`libexec-census-names-the-program`**: `install-census.test.ts`'s check that every removed libexec file is placed by some
  installer now names `door-process.mjs` beside `ccd`, both placed by the entry installer and never by `_inst_bins`.
- **`fence-headers-all-or-none`**: `ccrc-api` adds the three fence headers only when all three variables hold their shapes
  (the key 64 lowercase hex, the generation and the counter positive integers); any one malformed adds none, and the server
  refuses the fenced call. The plan said "each value checked"; this is that, read as one decision.
- **`act-key-headers-tested-in-the-argv-suite`**: the plan's `ccrc-api-act-key.test.ts` cases (the three headers on curl's
  stdin, none on its argv, a malformed value adding none) live in `door-tools-argv.test.ts`, beside every row's argv run
  through the real client, so the fenced rows and the header rule are one fixture.
- **`timer-tool-takes-after`**: the `timer_set` tool's duration field is named `after` (`90m`, `2h`, `3d`), and a note that
  begins with `-` is refused, because `ccrc-api timer set` reads its note from the argv, where a leading dash reads as a flag.
- **`delta-shadow-not-logged`**: the card door logs a shadow anchor's size once per card hash for the start and prompt
  forms; it does not log the delta form, which the door process fetches every minute.
- **`delta-is-the-prompt-canaries`**: the delta's canaries are the prompt form's (term, generation, card hash). Its worst
  case (two safe integers, `starting`, every count unmeasured, a capped mail count) is about 210 bytes, so the 300-byte cut
  never meets a canary today; the cut stays, from the end, for a later count.
- **`delta-appended-to-the-envelope`**: on a prompt that prints the owed anchor or the roster wake's card, the delta follows
  that text after one newline inside the same envelope (the anchor's 600 and the card's 2048 characters are clipped first, so
  neither cuts the delta).
- **`first-line-drops-you-are-the-overlord`**: `overlord-first-prompt` is now the plan's text, word for word: "Read your card
  with your card door, then answer your probes with your probe door." The designation's "You are the Overlord." is gone; the
  card says the role.
- **`card-body-still-names-ccrc-api`**: the card's own text names `ccrc-api` commands in a few lines (the mail, notes and
  timers sections, `server/src/continuity/card.ts`), and so do the anchor's instruction and the renewal's handover and spot
  probe mails. A2 phrases the client's next-step lines and the probe page's tail as door calls; those other texts are for the
  skill's and the card's owners, and the Overlord reads them as data.

## Carried, no change here

- **The claim checks neither the designation nor the term** (A1's carry, by design, F6). The door process presents the key
  on every fenced call and on every card page; the gate that consumes it (gates B) must check both, against the caller's
  live generation row.
- **The act-key answer is masked** (A1's F1 pin). The door process takes a key only when the claim's answer, as the client
  printed it, holds 64 lowercase hex; anything else is no key, keeps the nonce and backs off, so a masker that ever changed
  it fails closed (a case).
- **The deny path stands** (A1's F4): `~/.cc-sessions/.door/**` covers `mcp.json`, `delta` and both temp names.

## Live steps

- **Task 4 Step 5:** the session unit (`ccd/claude-session@.service`) sets no PATH, so `ccd supervise` runs with the user
  manager's default PATH, which resolves `/usr/bin/node`, v24.22.1, above the node floor (22.16.0). The pane's own PATH
  resolves the same node. The spawn step's suite ran in fixture HOMEs on the fleet box, never the live registry.
- **Task 5 Step 5:** unmeasured (above).

## Measurements

Filled in at the wave-done: growth, mutation and suite runs.
