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
  server's start and stopped at sign-in before any call. Ruled (fix round 1): accepted as B1's carry, measured live on the
  test box. Until then a dead door process means no doors until the session's next start. B1's live step should also
  search Claude Code's cache and log directories for the nonce after a scratch run (review 2735's residual).
- **`spawn-checks-the-client`** (was `spawn-does-not-check-the-client`; ruled in fix round 1): `_door_spawn` refuses the spawn
  unless the installed client (`~/.local/bin/ccrc-api`) is a regular file, executable and not a link ("the client is missing,
  linked or not executable"), so an Overlord never starts without its doors. The suites that make a surfaced spawn plant a
  stub client. The client is not pinned the way the program is, and it is not write-denied: a same-user residual.
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
- **`timer-tool-takes-after`**: the `timer_set` tool's duration field is named `after` (`90m`, `2h`, `3d`). A note that
  begins with `-`, or holds a NUL, is refused by the door itself. The client does not need the first: `parse_timer` checks
  only its first operand (`$1`, the duration) for a flag and takes the next as the note whatever it begins with. The door
  keeps the narrowing so a note never reads as a flag on the argv. A NUL could not ride an argv at all.
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
- **`card-body-still-names-ccrc-api`** (ruled in fix round 1): this PR owns the Overlord's form of the anchor instruction,
  since it makes the card door. `renderAnchor` ends the Overlord's anchor with `ANCHOR_INSTRUCTION_DOOR` ("Read it now with your
  card door"), every other role's with `ANCHOR_INSTRUCTION` (mutants D5 and D6). The card body's own `ccrc-api` lines (the
  mail, notes and timers sections, `server/src/continuity/card.ts`) and the renewal's handover and spot-probe mails carry to
  B1.
- **`whoami-retries-unless-it-names-another`** (ruled in fix round 1, review 2735 F4): a `whoami` that names another session
  refuses every call for the life of the process. Any other failure (an exit, a timeout, an unreadable answer) refuses only
  the call that asked, and the next call asks again after the claim's own back-off (1 s, doubling, to 30 s).
- **`delta-written-at-the-start`** (review 2735 F2): a spawn removes the last process's `delta` and `delta.tmp`, and the door
  process writes the cache once at its start, so a respawn's first prompt reads the unknown line or this generation's
  delta, never the last one's.
- **`client-unsets-the-fence`** (review 2735 F5): `ccrc-api` copies the act key, its generation and the counter into shell
  variables and unsets the exported ones before any child runs, so curl, jq and tmux inherit none of them.

## Carried, no change here

- **The claim checks neither the designation nor the term** (A1's carry, by design, F6). The door process presents the key
  on every fenced call and on every card page; the gate that consumes it (gates B) must check both, against the caller's
  live generation row.
- **The act-key answer is masked** (A1's F1 pin). The door process takes a key only when the claim's answer, as the client
  printed it, holds 64 lowercase hex; anything else is no key, keeps the nonce and backs off, so a masker that ever changed
  it fails closed (a case).
- **The deny path stands** (A1's F4): `~/.cc-sessions/.door/**` covers `mcp.json`, `delta` and both temp names.

## Fix round 1 (review 2735), the smaller fixes

- The program runs `main()` when started through a linked ancestor (real paths on both sides, F1).
- Each nonce removal reds alone: the process's own environment (a case reads it after `main()`), and the children's base
  environment (an in-process case, F6).
- `_door_spawn` runs under `local -; set +x`, so an inherited xtrace never prints the nonce, and refuses a directory at
  `mcp.json` (F7).
- The hook's delta reader requires the server's `ccrc-delta: ` prefix (else the unknown line), drops control bytes, refuses a
  linked `.door` or `<id>` directory, and gates on a 64-hex hash (F7).
- The door process answers `ping`, agrees only to the protocol versions it knows, drops a line past 1 MiB with one parse
  error, and queues at most one delta refresh at a time (F7). `ccrc-api`'s header-name comment names the suite that holds
  them, and that suite now compares them to `shared/continuity-door.ts`.
- The session hook refused one call of this round: a test edit whose text held `env | grep` (the account arm's "printing the
  whole environment"). It was not retried; the recording stubs append the three fence variables by name instead, so nothing
  prints the environment.

## Fix round 2 (review 2756)

- The delta's refresh asks `whoami` again under its back-off, so a whoami that failed at the start no longer starves the
  cache until the first tool call (F1).
- `ccrc-api` unsets the copies' own names (`FENCE_KEY`, `FENCE_GENERATION`, `FENCE_COUNTER`) before copying into them, so a
  caller that exported one carries nothing to a child (F2).
- `ccd-launch-surface-moves` plants a stub client, and its one case that reaches a surfaced spawn asserts no refusal (F3).
- The recording stubs (tmux, jq, curl, and `sh` for the client's tmux fallback) each mark that they ran in a file of their
  own and record every inherited name with the `FENCE_` or `CCRC_ACT_` prefix, names only, never values (F4).
- The hook's delta reader also drops U+0085, U+2028 to U+202E and U+2066 to U+2069, and a body that strips to nothing reads
  as the unknown line, never as the dark answer (F5).
- The claim reads `whoami` through the identity's one reader: a failed exit or an empty uuid is a failure that backs off,
  and another session is the permanent refusal (F6).
- Every new guard went red alone as a mutant and was restored from a saved copy. One mutant survived first: the claim's own
  branch for another session, dead once the reader decides the refusal, so it was removed.

## Live steps

- **Task 4 Step 5:** the session unit (`ccd/claude-session@.service`) sets no PATH, so `ccd supervise` runs with the user
  manager's default PATH, which resolves `/usr/bin/node`, v24.22.1, above the node floor (22.16.0). The pane's own PATH
  resolves the same node. The spawn step's suite ran in fixture HOMEs on the fleet box, never the live registry.
- **Task 5 Step 5:** unmeasured (above).

## Measurements

- **Growth** (net code lines against the merge base, the armed growth check green), after fix round 2: `ccd/ccd` +1,
  `ccd/ccrc` +1, `ccd/lib/door.sh` +29, `ccd (program)` +30, `ccd/session-hook.sh` +30; none over 40, no waiver.
- **Fix round 1's mutants, each red and restored from a saved copy:** eleven in the door process (the real-path start, the
  start's refresh, the two whoami rulings, the one queued refresh, each nonce removal, ping, the line bound, the NUL note,
  the protocol version), five in the spawn step (the xtrace guard, the client check and its link arm, the directory at
  `mcp.json`, the delta's removal), four in the hook's reader (links, control bytes, prefix, hash shape), the client's
  unset, and the anchor's D5 and D6 in `mutation-floors`.
- **Mutations, each red and restored from a saved copy:** the spawn step's nonce on jq's argv and its missing umask; five
  in the door process, the counter reused after a failed send among them; the hook's lease, link, regular-file and
  hash-gate checks; and the new mutation sets' deciders (`renderAnchor`'s delta form, `FIRST_PROMPT_OF_ROLE`, the probe
  page's door tail), which run in `mutation-floors`.
- **The first full run was red** on three guards this PR missed, fixed in one round: the shellcheck ratchet (a new
  `node` variable in `_door_spawn` made shellcheck read an existing `why=node-missing` as arithmetic, and the hook's
  delta reader reused two names the hook uses as arrays; both renamed, so no pin moves), the raw-spawn census (the spawn
  suite's helper was named `spawn`; now `spawnOnce`), and the settings census (the door process's four environment
  names and the client's three act-key names now carry their reasons). CodeQL flagged the FIFO case's `bash -c`
  writer; it is a node child with no shell now, and the regular-file mutant still reds that case.
- **horkos** blocks on `rules-mixed` (the entry installer and the session hook are its rules files, beside the rest of
  the change) and on three approvals by people. This PR cannot fix them without a split, which the brief's one PR rules
  out; they are the coordinator's to route.
