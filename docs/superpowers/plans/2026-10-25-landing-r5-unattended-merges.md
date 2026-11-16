# Landing order: ruling R5 amended, unattended landing is the goal — Record

**Spec:** `docs/superpowers/specs/2026-09-23-landing-order-and-main-churn-design.md` (§3 R5, §5.7, the amendment
note of 2026-10-25). **Programme:** `docs/superpowers/programs/landing-order.md`.

This is a text-only amendment: the coordinator skill (clause 15 and the wave lifecycle), the worker skill
(clause 16), the spec and the programme ledger, with their verbatim pins. No code and no live behaviour change.

## Deviations found

- **D-6857** — R5 overturned (operator, 2026-10-25): an unattended landing is the goal when every safeguard
  holds (the native queue re-tests the combined code, the required checks gate the enqueue, the landing binds
  the verified head with `--match-head-commit`, no `--admin`, no `update-branch`); a worker never merges its own
  PR. Recorded with it: ruling 5 (merge governance belongs to the repository's external policy authority; ccrc
  provides the enforcement points, and until that authority answers, wave 2b, a coordinator never uses `--admin`
  or GitHub API merge or enqueue calls), ruling 2 (the live queue's grouping, build 2 and merge 3, is accepted;
  one release may cover several commits) and ruling 3 (the two private repositories should drop strict
  protection; how they land is open, since the native queue is not on their plan).
