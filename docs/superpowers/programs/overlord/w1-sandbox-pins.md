# W1 sandbox: the carried pins (wave 229)

The last reviews of Sandbox B (#3205) and its hook surface arm (#3213) accepted them and left guards that no test
protected: a mutant survived every case. This wave closes them, makes the one product change the coordinator ruled
(call 1100, the settle's outcome word), and changes nothing else. No deviation number was allocated or defined.

Plan: `docs/superpowers/plans/2026-11-14-overlord-w1/w1-sandbox.md` (Tasks 8 and 9). Earlier note:
`w1-sandbox-b.md`. The coordinator folds this note into the ledger; neither is edited here.

## What changed

| Finding | Where | Change |
|---|---|---|
| F2 (review 3366) | door cases | A failure record that refuses, and one that throws, at the real composition: the drain is handed the body as unrecorded, so its failed stop logs the residual ("no row owes it") and never "it stays owed"; no row owes the stop and the pending row still names the body. |
| F3 (review 3366) | door case | A settle holds the coordination serialiser (its drain's keep-awake call is held open) while the Overlord's pause door is asked: the door's body does not run until the settle ends, then it runs. |
| F4 (review 3366) | function case, sets | A designation that changes during the registry read leaves the settle `stale` and the old read never goes live. `settleEvidenceStands` gets its own cases and a mutant set (E1 to E3) under the key `server/src/continuity/sandboxCheck.ts#settleEvidenceStands`. |
| F5 (review 3366, call 1100) | `server/src/continuity/routes.ts` | A re-read of the newest start that fails, and a designation that reads unmeasured the second time, answer `unread`; `stale` stays for evidence that changed. A `stale` or an `unread` settle writes one `console.warn('ccrc-server: …')` line. Each of the three has a case, and a fourth case shows a settle that acts or decides `none` writes no such line. |
| N1 (review 3598) | arm case | Rows installed under a 16-letter and a 17-letter role: the 16-letter role reads its row, the 17-letter one is refused with the unreadable reason, naming the role. |
| N2 (review 3598) | arm cases | A reader type that declares the built-in `Read`, and one that declares `foo__bar`, each through the file's `installed()` helper: `Read`, `mcp____x` and `mcp__bar__x` stay refused, the door's tool stays allowed. |
| N3 (review 3598) | `ccd/session-hook.sh` | The arm's header comment: comment lines only (4 removed, 7 added, no code line), agreed with the file's holder as an exact packet against main (2176 bytes, sha256 `2c9b8cd7…e223`). |
| N4 (review 3598) | arm case | The one assertion that checked only "some deny" checks the reason. |

The outcome word reaches no wire frame, stored row or console: `settleLoads` is called with `void` by the loads door,
and `settled` is a test-only completion signal (`deps.overlordSandbox`).

## Mutants: red before, green after

Each mutant is one exact text change, made in a scratch copy of the tree under the session's temp root (never the
worktree's files), run against one test file through the fleet test wrapper, then restored. "Main" is main's test
file at 2f140376dd; "new" is this branch's.

| Mutant | Main | New |
|---|---|---|
| F2: the composition hands the drain an empty set | 43/43 green | 2 red (refuses, throws) |
| F3: the composition hands the settle a pass-through serialiser | 43/43 green | 1 red |
| F3b: a private serialiser of its own (the settle waits on itself only) | not run | 1 red |
| F4: the designation half of `settleEvidenceStands` removed | 43/43 green | 1 red at the door; E1 killed by the sets |
| F5a: a failed re-read answers `stale` again (main's behaviour) | n/a | 2 red |
| F5b: the `stale`/`unread` log line removed | n/a | 3 red |
| E2: the newest-start half removed; E3: the newest start compared by id | n/a | killed by the sets |
| N1: the role bound widened to `^[a-z]+$` | 14/14 green | 1 red |
| N2: the `mcp__` filter on reader tools removed | 14/14 green | 2 red (one per input) |

Without any mutant: the door file 50/50, the arm file 17/17, the settle file 14/14.

## Departures (slugs, no number)

- `f3-door-held-by-the-settle-drain`: the brief's example was a designation act held open on the serialiser. The
  designate and retire doors ask the account gate's step-up first and refuse while sign-in is dark, as the test
  server is, so the case holds the SETTLE open instead (its drain's keep-awake call) and asks the Overlord's pause
  door, which enters the same `deps.serial` (the coordination serialiser) before any gate. A private serialiser
  of the settle's own (F3b) turns it red too, so it pins "the same serialiser", not only "a serialiser".
- `f5-unread-line-covers-the-first-read-too`: the one log line is written for every `stale` and every `unread`,
  including an `unread` from the first read (an expected surface, designation or newest start that could not be
  read), as the brief words it ("a `stale` or an `unread` settle writes one server log line").
- `n2-two-cases`: the reviewer's two inputs are two cases, so each is shown red on its own.

## Left out, and why

- N4's two other latent points (the helper spreading the runner's environment; `installed()` always writing one
  directory): neither is a present failure or can cause a false pass (review 3598, refuted); changing the helper is
  outside "if cheap".
- Review 3366 F1 and F6 to F11 and review 3598 N5 and N6 were not in this wave's brief.
- The whole test-tree type check was killed by the test slice's memory cap (exit 137); a narrow type check over the
  touched test files and what they import passed instead.
