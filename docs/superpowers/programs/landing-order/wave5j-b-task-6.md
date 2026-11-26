# Wave 5j-b, Task 6: the doors' refusal words

Plan: `docs/superpowers/plans/2026-11-25-landing-order-wave5j-doors.md`, Task 6 (D-9049). Base: `origin/main` at
`31d5d9ae26` (wave 5j-a merged as #3375).

## What changed

- `shared/landingLine.ts`: `LandingMutationCode` and `LANDING_MUTATION_CODE_MAP` gain `landing-entry-terminal`,
  `landing-entry-moved`, `landing-project-unknown` and `landing-record-unparseable`. The file also gains
  `LandingNoticeOutcome` (section 4.4), which nothing reads until Task 8.
- `shared/refusal.ts`: `LANDING_REFUSAL_STATUS` maps them to 409, 409, 404 and 500, as section 4.5 says. The map is
  spread into `REFUSAL_STATUS` and the advance's table, so both carry them.

## Measured

- `refusal-status.test.ts`'s `MUTATION` list gained the four words first: red (1 failed of 28), because the submap and
  `LANDING_MUTATION_CODES` lacked them.
- After the L0 edit: `refusal-status` 28 of 28 and `mail-routes` 61 of 61 green, each alone. The server typecheck is
  clean.
- No other source names a landing mutation code exhaustively (`git grep` for `landing-sequence-overflow` outside the
  three files finds only the store's one refusal).

## What moved on the base

Nothing cited in Task 6 moved between the plan's baseline and `31d5d9ae26`.
