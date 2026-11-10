# The wave lifecycle, in full

Every call below goes through `ccrc-api`, set up once in SKILL.md's "How to
call the API" — the client resolves the server address from
`~/.ccrc/agent.env` and reads the box token itself, refusing rather than
guessing at either, so no call below handles an address or a secret. One **run row per
wave**: `POST /api/runs` opens a new run for each wave of a program, not one
row for the whole program. `$REG` is `$HOME/.cc-sessions` throughout — SKILL.md's
"Learn who you are, first" defines it once and reads `$REG/<id>.uuid` for
`fromUuid`, the pair every mail call below needs.

## Where each step is

Each step is a file of its own, beside this one. Read the one for the step you are on,
and read it again after a compaction. Before the first dispatch of a program, read
steps 1 and 2.

| Part | File |
|---|---|
| Step 1, open the run | `wave-lifecycle-1-open.md` |
| Step 2, dispatch a wave | `wave-lifecycle-2-dispatch.md` |
| Step 3, read mail | `wave-lifecycle-3-mail.md` |
| Step 4, advance the run, and 4b, settle the work items | `wave-lifecycle-4-advance.md` |
| Step 5, the boundary between waves | `wave-lifecycle-5-boundary.md` |
| Step 5b, the landing route | `wave-lifecycle-5b-landing.md` |
| Step 6, the final merge | `wave-lifecycle-6-final-merge.md` |
| A workspace that is gone, a run that cannot finish, the run's signals, the routing door, peers and claims | `wave-lifecycle-run-care.md` |
| The ask lane and the approval lane | `wave-lifecycle-asks.md` |
| Mutation testing | `wave-lifecycle-mutation.md` |

A citation of this file by section, such as "§5b", means the file of that step.
