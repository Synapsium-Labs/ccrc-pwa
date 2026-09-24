# Program: child-tmpdir-bsd

Plan: `docs/superpowers/plans/2026-09-24-child-tmpdir-bsd-chmod.md` (the worker commits it beside the fix)
Home project: `ccrc-pwa`   Coordinator: `ccrc-pwa-calm-mesa`   Workspace: a fresh child
A one-wave follow-up to `child-reclamation` (CCR-15), whose wave 1 shipped the defect.

**What this program is.** Wave 1's `_child_tmpdir` privatises a child's temp root with `chmod 0700 -- "$dir"`.
BSD `chmod` (macOS) stops parsing options at the mode operand, reads the `--` as a file, and exits 1. On macOS,
every child therefore answers rc 2 and spawns without its own `TMPDIR`. It fails safe, but it is uncontained.
Reported by bright-river on 2026-09-24 from main's full run 36026429539 and PR #184's macOS leg. The diagnosis
was upheld by a three-agent check the same evening: every macOS failure goes through that rc 2, the runner's
`chmod` is BSD, and nothing else in waves 1–2 or in wave 3's new bash breaks on macOS. The fix moves one token
and adds a pin that reds on LINUX, so the next regression cannot hide behind the non-required macOS leg.

## Waves

| # | scope | deploy class | PRs | state |
|---|---|---|---|---|
| 1 | `chmod -- 0700 "$dir"`; a BSD-order `chmod` shim that makes the rc-0 cases discriminate on Linux; a literal-absence census of `chmod`/`chown`/`chgrp` with an operand before `--` | ccd only (fleet box first) | — | opening 2026-09-24 |

**Deviation block: three numbers, the first of them 3510** (allocated at run-open, 2026-09-24; floor now 3513).
The plan defines the first; no number of the block is spelled as a `D-` token here until a plan defines it.

**Sequencing, and why it does not wait for child-reclamation wave 3.** Wave 3 (run 148) holds claim 749 on
`ccd/ccd`. ws-slug-collision waited out a claim like that. This run does not, and the reason is recorded in
child-reclamation's ledger (2026-09-24): its edit is one line-neutral token in `_child_tmpdir`, a function wave 3
carries unchanged. The only text the two branches both change is ccd's generated stamp line, which wave 3
re-stamps when it merges main, as it must anyway. The owner of claim 749 is told.

**Not this programme's:** main's macOS 3/4 cancellation. `ccgpt-proxy.test.ts` (#165, 2026-09-22) wedges the
single macOS worker on every main run since it landed. It is a separate red that also blocks stable promotion.

## Decisions & deviations

- **2026-09-24 — opened.** The fix is `chmod -- 0700 "$dir"`, not the bare `chmod 0700 "$dir"`, because it keeps
  the end-of-options guard in an order both getopts accept. The pin simulates BSD argument order through a
  `chmod` shim that sets `POSIXLY_CORRECT` for chmod alone; setting it on bash would put bash in posix mode.

## Carried constraints

- Fixture HOMEs only; never run ccd against the live `$HOME`.
- Nothing else in `_child_tmpdir` moves (contract R1/R26 check-once shape).
- The macOS evidence is reported as measured, with job ids, or named as unmeasured.

## Next-wave brief

None — one wave. After merge: roll out (fleet box first), then confirm both test files pass on a macOS leg.
