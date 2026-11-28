# Task X5-FU: the artifact tier's five follow-ups

The task note for native Docs reader wave 61 (X5-FU, run 4170). It is what the ledger should learn from this wave. The design is `docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md`, and its leaf plan is `docs/superpowers/plans/2026-11-19-native-docs-html-artifacts.md`. That plan's Results section, "Follow-up wave X5-FU", gives what was measured, every mutation row and the slips.

## In short

- **Item 1, `x5-fu-console-prepare-waits` (D-9172).** A console range prepare that waits only because another prepare runs now waits up to 30 s (`laneWaitMs`, L1), and the artifact jobs pass it while it waits, so a console read beside an artifact page's first load is no longer answered busy and no artifact job waits behind it (D-9146 stays closed).
- **Item 2, `x5-fu-range-charge` (D-9173).** A small file's read is charged its size once per response, whatever range was asked (`artifactCharge`, L1), and a charge the hour cannot cover spends the hour, so the next request is refused before it reads.
- **Item 3, `x5-fu-expose-masked-label`.** `ccrc expose artifacts` and doctor refuse an artifact or content name the answer mask would alter, after the site rule, in the server's words, naming the key and never the value; the bash shape list is pinned to `CREDENTIAL_MASKS` by id and to `matchesShape` by a differential corpus. As the coordinator ruled, no refusal quotes such a value: the server's boot warning names it by its key only in every rule's refusal, and the setup command withholds more (any `sk-`, `eyJ`, `%`, backslash or double quote). D-9161 and the design's 2.3 carry dated notes.
- **Item 4, `x5-fu-a4-expose-nits`.** The console's port for the artifact tier is read through `_box_unit_env` (a CCRC_PORT line the service manager reads otherwise is refused, never the default); the stored-port remedy is the console's own where the console listens on 7790; a trailing-space port is pinned and passing runs print no stderr; `_box_env_value` (and its generated copy) reads only a readable regular file, so a whole doctor run beside an exposure-file directory prints no shell error.
- **Item 5, `x5-fu-a5-record-nits`.** Review 4153's four record nits, corrected in place; no console source changed.
- **Deviations.** D-9172 and D-9173, the brief's reserve, both used. None returned.

## Choices made in the wave, for the ledger

| Choice | Why |
|---|---|
| A console prepare's wait is set per job (`laneWaitMs`), not by what it waits behind | A queued job's wait is set when it queues; the prepare it waits behind can change |
| The artifact jobs ask `laneNext` with the console FIFO's first job the walk does not skip | Two changes together: a longer wait alone reopens D-9146, the passing alone keeps the busy answer |
| A small ranged read is charged what the read takes, not sent through the range path | The range path costs a prepare (one at a time, three a minute) on the lane item 1 relieved |
| One source of shapes for the bash mirror, pinned by test, not a second list kept by hand | One owner per fact; a widened mask source reds the pin |
| What a refusal withholds is wider than the mask in bash | A refusal also quotes values the grammar refused, where other shapes can stand |
| The console port is read through `_box_unit_env`, not a pattern of its own | The one model of what `ccrc.service` receives; the first scratch reader missed `export` |

## Slips, for the ledger

- Items 3 and 4 were first built in a scratch git worktree of this branch, outside this workspace (the coordinator ruled it a slip). Its results were not the gate: the hunks were applied again here with the edit tools and every suite and mutation row re-measured. The worktree is left to the reaper; its full path is in the head mail.
- Every Opus review was asked for at high effort and reported 15 (low) in its own context.

## Owed, for the ledger

- `_exp_console_port` still reads CCRC_PORT for the Caddyfile writer and `--off` from ccrc.env alone, without `_box_unit_env`'s refusal: a recorded bend of the one-owner rule (moving it changes what the console arms write and refuse); the follow-up makes it the same reader as the tier's.
- Doctor's `name` check prints the DuckDNS domain list, so a shaped label written before this wave still shows there.
- `config.ts`'s CCRC_PORT boot warning quotes up to 40 characters of the value, unmasked.
- The bash half of items 3 and 4 is one commit with one review, since they share hunks.
- A capability revoked from the list before its mint answer arrives is noted by the late answer (item 5's review).
- The shellcheck ratchet over `ccd/ccrc` and the server tests' typecheck were not measured locally (the test slice's memory cap); the hosted run measured both, green.
- Fix round 1 (review 4202): each shape the bash mirror covers is pinned to the server's matcher exactly, with fixed near misses in the differential (F1); every reader of the tier's console port, doctor included, refuses a CCRC_PORT the exposure file names, and on Linux every remedy for a CCRC_PORT line there names ccrc.env (F4; a file undecided as a whole, and a Mac's undecided line, take two steps: fix round 2).
- Fix round 2 (review 4211), tests and the record only: the cases that assert the Linux unit reader's words run as Linux on every runner (A1); origins with a shaped label last in the host and before the port (A2); three nits.
- Follow-up (review 4211 A1): on a Mac, an undecided CCRC_PORT line in the exposure file first gets the shell reader's rewrite-or-delete remedy, and the next run says to move it to ccrc.env, two steps where Linux takes one. The coordinator files the ticket; the fix is a code line in `ccd/ccrc`, at its growth bound in this pull request.
