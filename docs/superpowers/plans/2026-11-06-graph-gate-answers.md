# Graph gate: count answers, on any PATH

Fleet sessions run with no `~/.local/bin` on `PATH` on most accounts, so a bare `graphify` fails there. An audit
of the search gate measured what that did to it.

- **D-8046 (2026-11-06)** — The graph gate counts a read by its answer, and teaches a command that runs anywhere.
  `GRAPH_QUERY_RE` now takes a path-qualified or quoted call (283 real queries had gone uncounted). A read counts only
  when the response carries a line graphify starts an answer with, `GRAPH_ANSWER_RE`, so a failed query that exits 0
  no longer opens the gate or reads as a read (73 of 239 denied sessions had never had a real answer). The deny and
  the source-read nudge teach `GRAPH_RUN`, which brings `$HOME/.local/bin` with it and names no machine. The bound of
  three denials is unchanged, and it is what keeps a session with no working graphify moving.

## Known limits

- `GRAPH_ANSWER_RE` is graphify 0.9.9's wording. A pin bump that rewords those lines stops the count and spends each
  session's three denials; re-read them at a pin bump.
- A command held in a variable (`"$G" query`) is not a line the hook can read, so it still does not count.
- A query that writes its answer only to a file (`graphify query x > out`) returns nothing on the event and does not count.
- The `SessionStart` card, the compaction card and the skills still say bare `graphify`; a session that follows them
  on such an account fails once and then meets the deny, which carries the working line.
- The `PATH` gap itself is not closed here, and neither are the doctor's `graphify-path` remedies.
