# A Do item's tick carries a note: plan

One pull request. The task note is `docs/superpowers/programs/overlord/do-item-note.md`.

A coordinator's Do item could ask the operator for a note, and the operator had no way to give one: the console said
"Nothing to fill in" and the route refused any text. Two items went back and forth five times on one fleet for that
reason alone.

## Deviations found

- **D-8931 (2026-11-22)** — do-item-note. A Do item's tick may carry an optional note. It travels as the tick's
  `answer`, on the path a decide or value answer already takes: the tick's mail to the coordinator and the item's
  stored answer, in one transaction. No new column, wire field or writer. A tick with no note is as before.
