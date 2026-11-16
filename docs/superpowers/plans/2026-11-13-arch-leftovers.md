# Four architecture leftovers

- **D-8561 (2026-11-13)** — `arch-leftovers`: four small findings of a read-only architecture audit, fixed with no change in behaviour beyond the wording of one Docs failure: the 08-10 spec names context C10 Session host (D-8272); `ccd/contexts-edges.tsv` loses its one line inside a single context; the PWA words `helper-unavailable` by its detail, as D-7077 rules; and `server/src` and `shared/` cite ccd's code by function name, never by line.

## What changed

1. **The spec knows C10.** `docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md` listed nine bounded
   contexts while `ccd/contexts.tsv`, `consolidationCensus.ts`'s `CCD_CONTEXTS` and `rings/totality.test.ts` know ten.
   The numbered list gains item 10, Session host, and the sentence that follows it says the two packages' files map to
   the first nine. The context table gains no row: a C10 row is red by design (`CCD_ONLY_CONTEXTS`), so a line under
   the table says why there is none. `totality.test.ts` now also holds the numbered list to one item per context.
2. **No edge inside one context.** `_watchdog_one -> _wd_operator_hold_to` joined C1 to C1, so it was never a
   cross-context edge and the ratchet could only warn about it. The line is gone, and `ccd-contexts.test.ts` turns
   such a line red (a line naming a function that no longer exists stays a warning, as before).
3. **`helper-unavailable` by its detail (D-7077).** The PWA gave every `helper-unavailable` the python3 sentence, so
   `node-missing`, `redactor-missing` and `redactor-mismatch` read as a python3 problem. `docsText.ts`'s
   `HELPER_UNAVAILABLE_DETAIL_SENTENCE` words each of the three; a python detail, an unknown one or none keeps the
   spec's own sentence. `docs-failures.test.tsx` pins all of them.
4. **Citations by name.** 34 comment lines in `server/src` and `shared/` cited `ccd/ccd:<line>` or `ccd/ccrc:<line>`, and
   most of those lines now hold other code (`coord/routes.ts` named `_ws_reap_eval` and `cmd_ws_reap` for
   `_sync_uuid`'s cadence). Each now names the function or constant it meant, read from the comment's own claim and
   checked against today's `ccd/ccd`. `ccd-line-citations.test.ts` keeps line citations out of both trees.

## Deviations found

- The task asked for C10's row in the spec's context map. The map's own test refuses a row for a ccd-only context, so
  C10 is a numbered context and a note under the table instead.
- Tests under `server/test` and `pwa/test` still carry line citations of ccd in their comments; they are outside this
  change's scope and outside the new test's walk.
