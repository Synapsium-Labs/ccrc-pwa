# The temp-root collector on a device proven gone: plan

One pull request. The task note is `docs/superpowers/programs/overlord/collector-witness-device.md`.

A fleet moved to a new machine keeps the witness and quarantine records its temp-root collector wrote on the old one.
Each names the old filesystem's device number, so every one of them refused with `device` and never healed: on the
measured box 44 of 175 witness records named a block device the new machine does not have.

## Deviations found

- **D-8948 (2026-11-22)** — collector-witness-device. A witness or quarantine record whose recorded device is proven
  gone from the box (not mounted, no block-device entry, the listing's own control passing, never on macOS) starts
  over: a witness whose leaf is proven absent is dropped, and an empty slot of the record's own run is removed with its
  record. Nothing else is deleted on that proof; a tree still goes only through the unchanged fresh ladder. A volume
  that is attached but not active, or any answer that cannot be measured, keeps today's `device` refusal.
