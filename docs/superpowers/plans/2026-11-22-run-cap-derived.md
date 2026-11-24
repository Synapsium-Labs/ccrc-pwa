# The run cap, derived from the fleet host: plan

One pull request. The task note, with the formula, the constants and what was not verified, is
`docs/superpowers/programs/overlord/run-cap-derived.md`.

The operator ruled on 2026-11-22 that the fleet's run cap is derived from the machine the fleet runs on, and is not a
number somebody sets. The settings audit (`docs/superpowers/specs/2026-11-22-settings-audit.md`) records the ruling.

## Deviations found

- **D-8920 (2026-11-22)** — run-cap-derived. The cap in force is one function's answer: an operator's override when
  one stands, else the cap derived from the fleet host's memory and cores, else the stored number while the host is
  unmeasured. The stored number stops being the source of truth. A number set by hand before the change stays as an
  override until the operator chooses automatic, so no box's cap moves at the upgrade without a record.
